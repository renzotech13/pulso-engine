"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { generateThemedImage } from "@pulso/shared/image-gen";
import { runPublishAgentForCreative } from "@pulso/publish/agent";
import { newCorrelationId } from "@pulso/shared/ids";
import { createServiceRoleClient } from "./supabase/service";
import { createSupabaseServerClient } from "./supabase/server";
import { ACTIVE_TENANT_COOKIE } from "./tenant-context";
import { requireAdmin } from "./admin";

export async function createTenantAction(formData: FormData): Promise<void> {
  const name = String(formData.get("name") ?? "").trim();
  const slug = String(formData.get("slug") ?? "").trim();
  const rubro = String(formData.get("rubro") ?? "").trim();
  if (!name || !slug || !rubro) return;

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("create_tenant_with_owner", {
    tenant_name: name,
    tenant_slug: slug,
    tenant_rubro: rubro,
  });

  if (error || !data) {
    throw new Error(error?.message ?? "failed to create tenant");
  }

  const cookieStore = await cookies();
  cookieStore.set(ACTIVE_TENANT_COOKIE, data.id, { httpOnly: true, sameSite: "lax", path: "/" });
  redirect("/agents");
}

export async function switchTenantAction(formData: FormData): Promise<void> {
  const tenantId = String(formData.get("tenantId") ?? "");
  if (!tenantId) return;

  const cookieStore = await cookies();
  cookieStore.set(ACTIVE_TENANT_COOKIE, tenantId, { httpOnly: true, sameSite: "lax", path: "/" });
  redirect("/agents");
}

export async function signOutAction(): Promise<void> {
  const supabase = await createSupabaseServerClient();
  await supabase.auth.signOut();
  redirect("/login");
}

export async function updateCalendarSlotAction(formData: FormData): Promise<void> {
  const slotId = String(formData.get("slotId") ?? "");
  if (!slotId) return;

  const theme = String(formData.get("theme") ?? "").trim();
  const slotType = String(formData.get("slotType") ?? "");
  const status = String(formData.get("status") ?? "");
  if (!theme || !slotType || !status) return;

  const supabase = await createSupabaseServerClient();

  const { data: existing } = await supabase
    .from("content_calendar")
    .select("status")
    .eq("id", slotId)
    .single();

  // Free-text instruction the Creative agent folds into its next generation
  // (see apps/workers/src/agents/creative.ts). The list view's form doesn't
  // include this field at all, so `has` (not just an empty value) is what
  // tells a plain theme/type/status edit apart from the detail page's save —
  // otherwise every list-view resave would silently wipe out a saved note.
  const update: {
    theme: string;
    slot_type: "post" | "carousel" | "story" | "reel";
    status: "draft" | "approved" | "skipped";
    notes?: string | null;
  } = {
    theme,
    slot_type: slotType as "post" | "carousel" | "story" | "reel",
    status: status as "draft" | "approved" | "skipped",
  };
  if (formData.has("notes")) {
    update.notes = String(formData.get("notes") ?? "").trim() || null;
  }

  const { error } = await supabase.from("content_calendar").update(update).eq("id", slotId);

  if (error) throw new Error(error.message);

  // Only on the draft/skipped -> approved transition, not on every resave
  // of an already-approved slot — the Creative agent isn't idempotent-free
  // to trigger repeatedly for no reason, even though it no-ops safely.
  if (status === "approved" && existing?.status !== "approved") {
    const { error: rpcError } = await supabase.rpc("request_creative_generation", {
      target_calendar_slot_id: slotId,
    });
    if (rpcError) throw new Error(rpcError.message);
  }

  revalidatePath("/calendar");
}

export interface MoveCalendarSlotDateState {
  error: string | null;
}

/**
 * Moves a slot to a different date (e.g. "publish this today instead of the
 * 13th") — content_calendar's one-slot-per-tenant-per-day unique constraint
 * means the target day might already be taken, which is an expected outcome
 * here (the user free-picks any date), not an exceptional one, so it's
 * returned for inline display (useActionState, see move-date-form.tsx)
 * instead of thrown — same reasoning as useNewsSuggestionAction.
 */
export async function moveCalendarSlotDateAction(
  _prevState: MoveCalendarSlotDateState,
  formData: FormData,
): Promise<MoveCalendarSlotDateState> {
  const tenantId = String(formData.get("tenantId") ?? "");
  const slotId = String(formData.get("slotId") ?? "");
  const newDate = String(formData.get("newDate") ?? "");
  if (!tenantId || !slotId || !newDate) return { error: "Falta la fecha." };

  const supabase = await createSupabaseServerClient();
  await requireTenantEditor(supabase, tenantId);

  const { data: slot } = await supabase
    .from("content_calendar")
    .select("date, tenant_id")
    .eq("id", slotId)
    .maybeSingle();
  if (!slot || slot.tenant_id !== tenantId) return { error: "Este día ya no existe." };
  if (slot.date === newDate) return { error: null };

  const { error } = await supabase.from("content_calendar").update({ date: newDate }).eq("id", slotId);
  if (error) {
    if (error.code === "23505") {
      return { error: `Ya hay contenido planificado para el ${newDate}. Elige otro día.` };
    }
    return { error: error.message };
  }

  revalidatePath("/calendar");
  redirect(`/calendar/${newDate}`);
}

export async function approveCreativeAction(formData: FormData): Promise<void> {
  const creativeId = String(formData.get("creativeId") ?? "");
  if (!creativeId) return;

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.from("creatives").update({ status: "approved" }).eq("id", creativeId);
  if (error) throw new Error(error.message);
  revalidatePath("/calendar");
}

/**
 * Publishes right now — real Facebook/Instagram calls, not just a queued
 * event. request_creative_publish still runs first purely for its
 * permission check (owner/admin on the creative's tenant) and audit-trail
 * event row; apps/workers isn't running as a persistent process, so without
 * actually invoking the agent here too, that event would sit in the outbox
 * forever and the button would silently do nothing. Safe to also have a
 * real worker consume that same event later (e.g. once one is deployed):
 * runPublishAgentForCreative's own per-platform idempotency check means a
 * platform already published here just gets skipped, never double-posted.
 */
export async function requestPublishAction(formData: FormData): Promise<void> {
  const creativeId = String(formData.get("creativeId") ?? "");
  if (!creativeId) return;

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("request_creative_publish", { target_creative_id: creativeId });
  if (error) throw new Error(error.message);

  const { data: creative } = await supabase.from("creatives").select("tenant_id").eq("id", creativeId).single();
  if (!creative) throw new Error("creative not found");

  // respectHold=false: clicking "Publicar" is a deliberate human override of
  // that day's "No publicar" hold, unlike the automated triggers that also
  // call this same function.
  await runPublishAgentForCreative(creative.tenant_id, creativeId, newCorrelationId(), false);

  revalidatePath("/calendar");
}

/**
 * "No publicar": blocks only the automated publish triggers (see
 * runPublishAgentForCreative's respectHold param) — generation keeps
 * running normally, and a human can still click "Publicar" explicitly.
 * Toggles per calendar day, not per creative, since the point is to hold a
 * whole day regardless of which creative ends up attached to it.
 */
export async function toggleHoldPublishAction(formData: FormData): Promise<void> {
  const tenantId = String(formData.get("tenantId") ?? "");
  const slotId = String(formData.get("slotId") ?? "");
  const date = String(formData.get("date") ?? "");
  const holdPublish = formData.get("holdPublish") === "true";
  if (!tenantId || !slotId) return;

  const supabase = await createSupabaseServerClient();
  await requireTenantEditor(supabase, tenantId);

  const { error } = await supabase
    .from("content_calendar")
    .update({ hold_publish: holdPublish })
    .eq("id", slotId)
    .eq("tenant_id", tenantId);
  if (error) throw new Error(error.message);

  revalidatePath(`/calendar/${date}`);
  revalidatePath("/calendar");
}

/**
 * Deletes the current creative (row + its rendered asset, if any) and
 * re-requests generation for the same slot — the Creative agent's own
 * idempotency check only skips when a creative already exists, so removing
 * it first is what actually makes "regenerate" produce a fresh one.
 */
export async function regenerateCreativeAction(formData: FormData): Promise<void> {
  const creativeId = String(formData.get("creativeId") ?? "");
  const calendarSlotId = String(formData.get("calendarSlotId") ?? "");
  if (!creativeId || !calendarSlotId) return;

  const supabase = await createSupabaseServerClient();

  // Committed before the delete/RPC below so the Creative agent's async job
  // — which re-reads the slot fresh from the DB — sees the instruction even
  // if it runs a moment later.
  if (formData.has("notes")) {
    const notes = String(formData.get("notes") ?? "").trim() || null;
    const { error: notesError } = await supabase
      .from("content_calendar")
      .update({ notes })
      .eq("id", calendarSlotId);
    if (notesError) throw new Error(notesError.message);
  }

  const { data: creative } = await supabase
    .from("creatives")
    .select("tenant_id, type")
    .eq("id", creativeId)
    .single();

  if (creative) {
    const extension = creative.type === "video" ? "mp4" : "png";
    await supabase.storage.from("creative-assets").remove([`${creative.tenant_id}/${creativeId}.${extension}`]);
  }

  const { error: deleteError } = await supabase.from("creatives").delete().eq("id", creativeId);
  if (deleteError) throw new Error(deleteError.message);

  const { error: rpcError } = await supabase.rpc("request_creative_generation", {
    target_calendar_slot_id: calendarSlotId,
  });
  if (rpcError) throw new Error(rpcError.message);

  revalidatePath("/calendar");
}

/**
 * Frees up a day entirely — deletes the creative (and whatever got
 * rendered for it) and resets the slot back to 'draft' with no
 * creative_id, instead of regenerateCreativeAction's "delete + immediately
 * ask for a replacement". Refuses on anything already actually published:
 * clearing the internal record wouldn't undo the real post, it would just
 * make the dashboard lie about what's live.
 */
export async function deleteCreativeAction(formData: FormData): Promise<void> {
  const tenantId = String(formData.get("tenantId") ?? "");
  const date = String(formData.get("date") ?? "");
  const creativeId = String(formData.get("creativeId") ?? "");
  const slotId = String(formData.get("slotId") ?? "");
  if (!tenantId || !creativeId || !slotId) return;

  const supabase = await createSupabaseServerClient();
  await requireTenantEditor(supabase, tenantId);

  const { data: creative } = await supabase
    .from("creatives")
    .select("tenant_id, type")
    .eq("id", creativeId)
    .maybeSingle();
  if (!creative || creative.tenant_id !== tenantId) throw new Error("creative not found");

  const { data: published } = await supabase
    .from("publications")
    .select("id")
    .eq("creative_id", creativeId)
    .eq("status", "published")
    .limit(1);
  if (published && published.length > 0) {
    throw new Error("Esta pieza ya se publicó de verdad — no se puede eliminar, solo el registro quedaría inconsistente.");
  }

  if (creative.type === "carousel") {
    const { data: files } = await supabase.storage
      .from("creative-assets")
      .list(tenantId, { search: `${creativeId}-` });
    const paths = (files ?? []).map((f) => `${tenantId}/${f.name}`);
    if (paths.length > 0) await supabase.storage.from("creative-assets").remove(paths);
  } else {
    const extension = creative.type === "video" ? "mp4" : "png";
    await supabase.storage.from("creative-assets").remove([`${tenantId}/${creativeId}.${extension}`]);
  }

  const { error: deleteError } = await supabase.from("creatives").delete().eq("id", creativeId);
  if (deleteError) throw new Error(deleteError.message);

  const { error: slotError } = await supabase
    .from("content_calendar")
    .update({ creative_id: null, status: "draft" })
    .eq("id", slotId)
    .eq("tenant_id", tenantId);
  if (slotError) throw new Error(slotError.message);

  revalidatePath(`/calendar/${date}`);
  revalidatePath("/calendar");
}

export async function requestCalendarRegenerationAction(formData: FormData): Promise<void> {
  const tenantId = String(formData.get("tenantId") ?? "");
  if (!tenantId) return;

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("request_calendar_regeneration", {
    target_tenant_id: tenantId,
  });
  if (error) throw new Error(error.message);
  revalidatePath("/calendar");
}

const MAX_MEDIA_FILES = 6;

/**
 * Uploads to the public `product-media` bucket (marketing photos/videos —
 * these are meant to end up posted to social media, so a public bucket with
 * no signed-URL expiry is the right call, not a privacy gap). Storage RLS
 * still enforces the path's tenant segment matches the caller's own tenant.
 */
async function uploadProductMedia(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  tenantId: string,
  files: FormDataEntryValue[],
): Promise<string[]> {
  const urls: string[] = [];
  for (const entry of files.slice(0, MAX_MEDIA_FILES)) {
    if (!(entry instanceof File) || entry.size === 0) continue;

    const path = `${tenantId}/${crypto.randomUUID()}-${entry.name}`;
    const { error } = await supabase.storage.from("product-media").upload(path, entry);
    if (error) throw new Error(`failed to upload ${entry.name}: ${error.message}`);

    const { data } = supabase.storage.from("product-media").getPublicUrl(path);
    urls.push(data.publicUrl);
  }
  return urls;
}

export async function createProductAction(formData: FormData): Promise<void> {
  const tenantId = String(formData.get("tenantId") ?? "");
  const name = String(formData.get("name") ?? "").trim();
  if (!tenantId || !name) return;

  const priceRaw = String(formData.get("price") ?? "").trim();
  const price = priceRaw ? Number(priceRaw) : null;
  const description = String(formData.get("description") ?? "").trim() || null;
  const category = String(formData.get("category") ?? "").trim() || null;

  const supabase = await createSupabaseServerClient();
  const [photoUrls, videoUrls] = await Promise.all([
    uploadProductMedia(supabase, tenantId, formData.getAll("photos")),
    uploadProductMedia(supabase, tenantId, formData.getAll("videos")),
  ]);

  const { error } = await supabase.from("products_services").insert({
    tenant_id: tenantId,
    name,
    price,
    description,
    category,
    photo_urls: photoUrls,
    video_urls: videoUrls,
  });

  if (error) throw new Error(error.message);
  revalidatePath("/catalog");
}

export async function upsertBrandKitAction(formData: FormData): Promise<void> {
  const tenantId = String(formData.get("tenantId") ?? "");
  if (!tenantId) return;

  const colorPrimary = String(formData.get("colorPrimary") ?? "").trim() || null;
  const colorSecondary = String(formData.get("colorSecondary") ?? "").trim() || null;
  const toneDescription = String(formData.get("toneDescription") ?? "").trim() || null;
  const voiceTraining = String(formData.get("voiceTraining") ?? "").trim() || null;
  const websiteUrl = String(formData.get("websiteUrl") ?? "").trim() || null;

  const supabase = await createSupabaseServerClient();

  // logo_url/brief_document_url are only included in the payload when a new
  // file was actually uploaded — upsert only overwrites the columns it's
  // given, so omitting the key here leaves the existing one untouched on a
  // plain edit of the other fields.
  const logoEntry = formData.get("logo");
  const briefDocumentEntry = formData.get("briefDocument");
  const update: {
    tenant_id: string;
    color_primary: string | null;
    color_secondary: string | null;
    tone_description: string | null;
    voice_training: string | null;
    website_url: string | null;
    logo_url?: string;
    brief_document_url?: string;
    brief_document_name?: string;
  } = {
    tenant_id: tenantId,
    color_primary: colorPrimary,
    color_secondary: colorSecondary,
    tone_description: toneDescription,
    voice_training: voiceTraining,
    website_url: websiteUrl,
  };

  if (logoEntry instanceof File && logoEntry.size > 0) {
    const path = `${tenantId}/logo-${crypto.randomUUID()}-${logoEntry.name}`;
    const { error: uploadError } = await supabase.storage.from("brand-assets").upload(path, logoEntry);
    if (uploadError) throw new Error(`failed to upload logo: ${uploadError.message}`);

    const { data } = supabase.storage.from("brand-assets").getPublicUrl(path);
    update.logo_url = data.publicUrl;
  }

  if (briefDocumentEntry instanceof File && briefDocumentEntry.size > 0) {
    const path = `${tenantId}/brief-${crypto.randomUUID()}-${briefDocumentEntry.name}`;
    const { error: uploadError } = await supabase.storage
      .from("brand-assets")
      .upload(path, briefDocumentEntry);
    if (uploadError) throw new Error(`failed to upload brief document: ${uploadError.message}`);

    const { data } = supabase.storage.from("brand-assets").getPublicUrl(path);
    update.brief_document_url = data.publicUrl;
    update.brief_document_name = briefDocumentEntry.name;
  }

  const { error } = await supabase.from("brand_kits").upsert(update, { onConflict: "tenant_id" });
  if (error) throw new Error(error.message);
  revalidatePath("/brand-kit");
}

const PHOTO_FRAME_ASPECT_RATIOS: Record<string, { width: number; height: number }> = {
  "1:1": { width: 1080, height: 1080 },
  "4:5": { width: 1080, height: 1350 },
  "9:16": { width: 1080, height: 1920 },
};

/**
 * One "photo-frame" render_templates row per tenant — a tenant-uploaded
 * overlay composited on top of whatever photo(s) they upload later from a
 * calendar day. render_templates has no insert/update policy for regular
 * users by design (see migration 00000000000006); 00000000000018 carves out
 * exactly this one component_ref so this action can run under the caller's
 * own RLS-scoped session like every other tenant action, instead of
 * reaching for the service role and hand-rolling the membership check RLS
 * already does everywhere else.
 */
export async function upsertPhotoFrameAction(formData: FormData): Promise<void> {
  const tenantId = String(formData.get("tenantId") ?? "");
  if (!tenantId) return;

  const aspectRatio = String(formData.get("aspectRatio") ?? "1:1");
  const size = PHOTO_FRAME_ASPECT_RATIOS[aspectRatio] ?? PHOTO_FRAME_ASPECT_RATIOS["1:1"]!;

  const supabase = await createSupabaseServerClient();

  const { data: existing } = await supabase
    .from("render_templates")
    .select("id, frame_image_url")
    .eq("tenant_id", tenantId)
    .eq("component_ref", "photo-frame")
    .maybeSingle();

  let frameImageUrl = existing?.frame_image_url ?? null;

  const frameEntry = formData.get("frame");
  if (frameEntry instanceof File && frameEntry.size > 0) {
    const path = `${tenantId}/photo-frame-${crypto.randomUUID()}-${frameEntry.name}`;
    const { error: uploadError } = await supabase.storage.from("brand-assets").upload(path, frameEntry);
    if (uploadError) throw new Error(`failed to upload frame: ${uploadError.message}`);

    const { data } = supabase.storage.from("brand-assets").getPublicUrl(path);
    frameImageUrl = data.publicUrl;
  }

  if (!frameImageUrl) throw new Error("Sube un marco (PNG) antes de guardar.");

  const payload = {
    tenant_id: tenantId,
    name: "photo-frame",
    type: "static",
    engine: "html",
    component_ref: "photo-frame",
    status: "active",
    frame_image_url: frameImageUrl,
    canvas_width: size.width,
    canvas_height: size.height,
  };

  const { error } = existing
    ? await supabase.from("render_templates").update(payload).eq("id", existing.id)
    : await supabase.from("render_templates").insert(payload);

  if (error) throw new Error(error.message);
  revalidatePath("/brand-kit");
}

/**
 * Adds real photos to the tenant's media library — the Creative agent picks
 * from this pool (oldest/never-used first) for regular posts that aren't
 * about a specific catalog product, instead of falling straight to an
 * AI-generated image. Plain authenticated insert (media_assets has its own
 * owner/admin RLS policy), unlike the photo-frame creative action below.
 */
export async function uploadMediaAssetsAction(formData: FormData): Promise<void> {
  const tenantId = String(formData.get("tenantId") ?? "");
  if (!tenantId) return;

  const supabase = await createSupabaseServerClient();

  const files = formData
    .getAll("photos")
    .filter((entry): entry is File => entry instanceof File && entry.size > 0);
  if (files.length === 0) return;

  const rows: { tenant_id: string; kind: "image"; url: string }[] = [];
  for (const file of files) {
    const path = `${tenantId}/library-${crypto.randomUUID()}-${file.name}`;
    const { error: uploadError } = await supabase.storage.from("brand-assets").upload(path, file);
    if (uploadError) throw new Error(`failed to upload photo: ${uploadError.message}`);
    const { data } = supabase.storage.from("brand-assets").getPublicUrl(path);
    rows.push({ tenant_id: tenantId, kind: "image", url: data.publicUrl });
  }

  const { error } = await supabase.from("media_assets").insert(rows);
  if (error) throw new Error(error.message);

  revalidatePath("/brand-kit");
}

export async function deleteMediaAssetAction(formData: FormData): Promise<void> {
  const tenantId = String(formData.get("tenantId") ?? "");
  const assetId = String(formData.get("assetId") ?? "");
  if (!tenantId || !assetId) return;

  const supabase = await createSupabaseServerClient();

  const { data: asset } = await supabase
    .from("media_assets")
    .select("url")
    .eq("id", assetId)
    .eq("tenant_id", tenantId)
    .maybeSingle();

  const { error } = await supabase
    .from("media_assets")
    .delete()
    .eq("id", assetId)
    .eq("tenant_id", tenantId);
  if (error) throw new Error(error.message);

  if (asset?.url) {
    const marker = "/brand-assets/";
    const idx = asset.url.indexOf(marker);
    if (idx !== -1) {
      await supabase.storage.from("brand-assets").remove([asset.url.slice(idx + marker.length)]);
    }
  }

  revalidatePath("/brand-kit");
}

/**
 * Uploads one or more real photos, composites them under the tenant's own
 * "photo-frame" template (configured in Brand Kit), and creates the
 * calendar slot + creative directly — no Planner/LLM involved, this is a
 * manual creative for a photo the tenant already has (a match, an event).
 *
 * content_calendar and creatives both deliberately have no insert policy
 * for `authenticated` (creation is normally the Planner/Creative agent's
 * job, running as service_role — see 00000000000003 and 00000000000006).
 * Rather than punch a matching RLS hole in two more tables, this action
 * does its own owner/admin check (the same role gate their *update*
 * policies already use) and then writes with the service role — it's
 * standing in for the Creative agent here, just triggered by a click
 * instead of an event.
 */
async function requireTenantEditor(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  tenantId: string,
): Promise<void> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("no autenticado");

  const { data: membership } = await supabase
    .from("memberships")
    .select("role")
    .eq("tenant_id", tenantId)
    .eq("user_id", user.id)
    .maybeSingle();
  if (!membership || !["owner", "admin"].includes(membership.role)) {
    throw new Error("no autorizado");
  }
}

// Storage uploads stay on the caller's own session — creative-assets already
// allows any tenant member to write into their own tenant folder.
async function uploadPhotoFrameSources(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  tenantId: string,
  formData: FormData,
): Promise<string[]> {
  const photoFiles = formData
    .getAll("photos")
    .filter((entry): entry is File => entry instanceof File && entry.size > 0);
  if (photoFiles.length === 0) throw new Error("Sube al menos una foto.");

  const photoUrls: string[] = [];
  for (const file of photoFiles) {
    const path = `${tenantId}/photo-frame-src-${crypto.randomUUID()}-${file.name}`;
    const { error: uploadError } = await supabase.storage.from("creative-assets").upload(path, file);
    if (uploadError) throw new Error(`failed to upload photo: ${uploadError.message}`);
    const { data } = supabase.storage.from("creative-assets").getPublicUrl(path);
    photoUrls.push(data.publicUrl);
  }
  return photoUrls;
}

/**
 * Deliberately not awaited by callers — a photo-frame render re-screenshots
 * every photo (0..N-1) serially, which for a double-digit batch can take
 * 30s+. Awaiting it here used to make the whole form submission (and the
 * button) hang for that long with zero feedback, which is exactly what
 * pushed a real user into double-submitting and duplicating their batch.
 * The <img>/render route is lazy anyway (renders on first request, cached
 * after) — this call is just an optional warm-up, so letting it run in the
 * background and swallowing its result is safe.
 */
function triggerPhotoFrameRender(creativeId: string): void {
  const renderTemplatesUrl = process.env.NEXT_PUBLIC_RENDER_TEMPLATES_URL ?? "http://localhost:3001";
  fetch(`${renderTemplatesUrl}/api/render/${creativeId}.png`).catch(() => {
    // swallowed — see comment above
  });
}

/**
 * Adds photos to an already-existing photo-frame creative — the explicit
 * "same publication" path (as opposed to createPhotoFrameCreativeAction,
 * which always starts a new one). Used to split a large batch across
 * several uploads without losing what was already added.
 */
export async function addPhotosToCreativeAction(formData: FormData): Promise<void> {
  const tenantId = String(formData.get("tenantId") ?? "");
  const date = String(formData.get("date") ?? "");
  const creativeId = String(formData.get("creativeId") ?? "");
  if (!tenantId || !date || !creativeId) return;

  const supabase = await createSupabaseServerClient();
  await requireTenantEditor(supabase, tenantId);

  const photoUrls = await uploadPhotoFrameSources(supabase, tenantId, formData);

  const service = createServiceRoleClient();
  const { data: creative } = await service
    .from("creatives")
    .select("id, tenant_id, brief")
    .eq("id", creativeId)
    .maybeSingle();
  if (!creative || creative.tenant_id !== tenantId) throw new Error("creative not found");

  const existingBrief = creative.brief as { photoUrls?: unknown; caption?: unknown };
  const priorPhotoUrls = Array.isArray(existingBrief.photoUrls) ? existingBrief.photoUrls : [];
  const allPhotoUrls = [...priorPhotoUrls, ...photoUrls];
  const caption = typeof existingBrief.caption === "string" ? existingBrief.caption : "";

  const { error: updateError } = await service
    .from("creatives")
    .update({
      type: allPhotoUrls.length > 1 ? "carousel" : "image",
      status: "pending",
      brief: { photoUrls: allPhotoUrls, caption },
    })
    .eq("id", creativeId);
  if (updateError) throw new Error(updateError.message);

  triggerPhotoFrameRender(creativeId);
  revalidatePath(`/calendar/${date}`);
}

/**
 * Removes a single photo from a photo-frame creative's brief by index.
 * Dropping the last remaining photo deletes the creative outright (and
 * un-features it from the day, if it was) rather than leaving an empty
 * publication behind.
 */
export async function removePhotoFromCreativeAction(formData: FormData): Promise<void> {
  const tenantId = String(formData.get("tenantId") ?? "");
  const date = String(formData.get("date") ?? "");
  const creativeId = String(formData.get("creativeId") ?? "");
  const index = Number(formData.get("index"));
  if (!tenantId || !date || !creativeId || !Number.isInteger(index)) return;

  const supabase = await createSupabaseServerClient();
  await requireTenantEditor(supabase, tenantId);

  const service = createServiceRoleClient();
  const { data: creative } = await service
    .from("creatives")
    .select("id, tenant_id, brief, asset_urls")
    .eq("id", creativeId)
    .maybeSingle();
  if (!creative || creative.tenant_id !== tenantId) throw new Error("creative not found");

  const existingBrief = creative.brief as { photoUrls?: unknown; caption?: unknown };
  const photoUrls = Array.isArray(existingBrief.photoUrls) ? existingBrief.photoUrls : [];
  if (index < 0 || index >= photoUrls.length) return;

  const remaining = photoUrls.filter((_: unknown, i: number) => i !== index);
  const caption = typeof existingBrief.caption === "string" ? existingBrief.caption : "";

  // route.ts's "already rendered" check only ever compares file COUNT
  // against the brief's photo count — it never actually checks that the
  // files it finds correspond to the current photos. That's fine when a
  // batch only grows (old files stay valid, so the check still fires a
  // real render), but a shrink like this leaves at least as many old files
  // on disk as the new (smaller) count, so it would short-circuit forever
  // and skip the real render — leaving status/asset_urls stuck stale.
  // Wiping every existing render for this creative forces a real one.
  const existingAssetPaths = (creative.asset_urls ?? [])
    .map((url) => {
      const marker = "/creative-assets/";
      const idx = url.indexOf(marker);
      return idx === -1 ? null : url.slice(idx + marker.length);
    })
    .filter((path): path is string => path !== null);
  if (existingAssetPaths.length > 0) {
    await service.storage.from("creative-assets").remove(existingAssetPaths);
  }

  if (remaining.length === 0) {
    await service.from("creatives").delete().eq("id", creativeId);
    await service
      .from("content_calendar")
      .update({ creative_id: null })
      .eq("tenant_id", tenantId)
      .eq("date", date)
      .eq("creative_id", creativeId);
  } else {
    const { error: updateError } = await service
      .from("creatives")
      .update({
        type: remaining.length > 1 ? "carousel" : "image",
        status: "pending",
        // Cleared rather than left stale — every file backing the old
        // asset_urls was just deleted above, so leaving them here would
        // point the thumbnail grid at 404s until the background render
        // (fired below) finishes and overwrites this with the real set.
        asset_urls: [],
        brief: { photoUrls: remaining, caption },
      })
      .eq("id", creativeId);
    if (updateError) throw new Error(updateError.message);
    triggerPhotoFrameRender(creativeId);
  }

  revalidatePath(`/calendar/${date}`);
}

/**
 * Shared by regenerate/replace below: both need the creative's own tenant_id
 * (ownership check) and its carousel brief (slides + current photoUrls) to
 * know what they're editing.
 */
async function getOwnedCarouselCreative(
  service: ReturnType<typeof createServiceRoleClient>,
  tenantId: string,
  creativeId: string,
): Promise<{ brief: Record<string, unknown>; slides: string[]; photoUrls: Array<string | null> }> {
  const { data: creative } = await service
    .from("creatives")
    .select("tenant_id, brief")
    .eq("id", creativeId)
    .maybeSingle();
  if (!creative || creative.tenant_id !== tenantId) throw new Error("creative not found");

  const brief = creative.brief as Record<string, unknown> & { slides?: unknown; photoUrls?: unknown };
  const slides = Array.isArray(brief.slides) ? (brief.slides as string[]) : [];
  const photoUrls: Array<string | null> = Array.isArray(brief.photoUrls)
    ? (brief.photoUrls as Array<string | null>)
    : new Array(slides.length).fill(null);

  return { brief, slides, photoUrls };
}

/**
 * Clears just this slide's stale rendered file — handleCarouselRender's
 * "already rendered" check only compares file COUNT to slide count, so
 * dropping any one file below that count is enough to make it re-render
 * every slide fresh (cheap: it's a handful of Puppeteer screenshots, and the
 * unrelated slides just re-composite the same photo they already had).
 */
async function clearCarouselRender(
  service: ReturnType<typeof createServiceRoleClient>,
  tenantId: string,
  creativeId: string,
  slideIndex: number,
): Promise<void> {
  await service.storage.from("creative-assets").remove([`${tenantId}/${creativeId}-${slideIndex}.png`]);
}

/**
 * Regenerates a single carousel slide's photo with Gemini, themed to that
 * slide's own text — for fixing one bad slide (cropped, mistimed, Gemini
 * baked in garbled text, ...) without touching the other slides or the copy.
 */
export async function regenerateCarouselSlideAction(formData: FormData): Promise<void> {
  const tenantId = String(formData.get("tenantId") ?? "");
  const date = String(formData.get("date") ?? "");
  const creativeId = String(formData.get("creativeId") ?? "");
  const slideIndex = Number(formData.get("slideIndex"));
  if (!tenantId || !date || !creativeId || !Number.isInteger(slideIndex)) return;

  const supabase = await createSupabaseServerClient();
  await requireTenantEditor(supabase, tenantId);

  const service = createServiceRoleClient();
  const { brief, slides, photoUrls } = await getOwnedCarouselCreative(service, tenantId, creativeId);
  const slideText = slides[slideIndex];
  if (slideText === undefined) throw new Error("ese slide no existe");

  const [{ data: slot }, { data: tenant }, { data: brandKit }] = await Promise.all([
    supabase.from("content_calendar").select("theme").eq("tenant_id", tenantId).eq("date", date).maybeSingle(),
    supabase.from("tenants").select("rubro").eq("id", tenantId).single(),
    supabase.from("brand_kits").select("tone_description, voice_training").eq("tenant_id", tenantId).maybeSingle(),
  ]);

  // Same tenant-authored guidance creative.ts folds into every image prompt
  // (see apps/workers/src/agents/creative.ts) — kept in sync by hand since
  // this action builds its own prompt rather than reusing that one.
  const brandVoiceParts = [brandKit?.tone_description, brandKit?.voice_training].filter(
    (part): part is string => Boolean(part?.trim()),
  );
  const brandTrainingForImage =
    brandVoiceParts.length > 0 ? ` Indicaciones de la marca: ${brandVoiceParts.join("\n")}.` : "";

  const prompt = [
    `Fotografía temática para UN slide de un carrusel de Instagram/Facebook, para un negocio de tipo "${tenant?.rubro ?? "general"}".`,
    `Tema general del carrusel: ${slot?.theme ?? ""}.`,
    // Ver el comentario equivalente en creative.ts: citar la frase como «este
    // slide dice "..."» hacía que el modelo la dibujara dentro de la foto.
    `Concepto a ilustrar visualmente, sin escribirlo: ${slideText}`,
    `La imagen debe transmitir esa idea de forma puramente visual, ocupando el 100% del encuadre de borde a borde, sin zonas vacías, planas ni espacios en blanco reservados (el overlay de texto se agrega después por separado, en post-producción). Sin logos. Una sola escena fotográfica real, capturada con cámara. Prohibido: texto, letras, palabras, titulares o tipografía de cualquier idioma dentro de la imagen; portadas de revista, periódicos o artículos simulados; infografías, diagramas, collages, cuadrículas, paneles divididos, maquetas 3D, iconos, pictogramas o elementos etiquetados.${brandTrainingForImage}`,
  ].join(" ");

  const imageBuffer = await generateThemedImage(prompt);
  if (!imageBuffer) {
    throw new Error("Gemini no devolvió una imagen — revisa GEMINI_API_KEY o el límite de uso.");
  }

  const assetPath = `${tenantId}/generated-manual-${creativeId}-slide${slideIndex}-${Date.now()}.png`;
  const { error: uploadError } = await service.storage
    .from("creative-assets")
    .upload(assetPath, imageBuffer, { contentType: "image/png" });
  if (uploadError) throw new Error(`upload failed: ${uploadError.message}`);

  const { data: publicUrlData } = service.storage.from("creative-assets").getPublicUrl(assetPath);
  const nextPhotoUrls = [...photoUrls];
  nextPhotoUrls[slideIndex] = publicUrlData.publicUrl;

  const { error: updateError } = await service
    .from("creatives")
    .update({ status: "pending", brief: { ...brief, slides, photoUrls: nextPhotoUrls } })
    .eq("id", creativeId);
  if (updateError) throw new Error(updateError.message);

  await clearCarouselRender(service, tenantId, creativeId, slideIndex);
  triggerPhotoFrameRender(creativeId);
  revalidatePath(`/calendar/${date}`);
}

/**
 * Edits the real post caption — the text that accompanies the publication on
 * Facebook/Instagram, below the image(s) (never printed on the image itself).
 * Applies to every creative type (post, carousel, story, reel): the caption
 * lives at brief.caption regardless of type, and editing it never touches
 * any rendered asset, so there's no re-render to trigger.
 */
export async function updateCreativeCaptionAction(formData: FormData): Promise<void> {
  const tenantId = String(formData.get("tenantId") ?? "");
  const date = String(formData.get("date") ?? "");
  const creativeId = String(formData.get("creativeId") ?? "");
  const caption = String(formData.get("caption") ?? "").trim();
  if (!tenantId || !date || !creativeId) return;

  const supabase = await createSupabaseServerClient();
  await requireTenantEditor(supabase, tenantId);

  const service = createServiceRoleClient();
  const { data: creative } = await service
    .from("creatives")
    .select("tenant_id, brief")
    .eq("id", creativeId)
    .maybeSingle();
  if (!creative || creative.tenant_id !== tenantId) throw new Error("creative not found");

  const brief = creative.brief as Record<string, unknown>;
  const { error: updateError } = await service
    .from("creatives")
    .update({ brief: { ...brief, caption } })
    .eq("id", creativeId);
  if (updateError) throw new Error(updateError.message);

  revalidatePath(`/calendar/${date}`);
}

/**
 * Replaces a single carousel slide's photo with a manually uploaded file —
 * for when the tenant has their own photo they'd rather use than anything
 * AI-generated or from the media library.
 */
export async function replaceCarouselSlidePhotoAction(formData: FormData): Promise<void> {
  const tenantId = String(formData.get("tenantId") ?? "");
  const date = String(formData.get("date") ?? "");
  const creativeId = String(formData.get("creativeId") ?? "");
  const slideIndex = Number(formData.get("slideIndex"));
  const photo = formData.get("photo");
  if (!tenantId || !date || !creativeId || !Number.isInteger(slideIndex)) return;
  if (!(photo instanceof File) || photo.size === 0) return;

  const supabase = await createSupabaseServerClient();
  await requireTenantEditor(supabase, tenantId);

  const service = createServiceRoleClient();
  const { brief, slides, photoUrls } = await getOwnedCarouselCreative(service, tenantId, creativeId);
  if (slideIndex < 0 || slideIndex >= slides.length) throw new Error("ese slide no existe");

  const assetPath = `${tenantId}/uploaded-${creativeId}-slide${slideIndex}-${crypto.randomUUID()}-${photo.name}`;
  const { error: uploadError } = await service.storage.from("creative-assets").upload(assetPath, photo);
  if (uploadError) throw new Error(`upload failed: ${uploadError.message}`);

  const { data: publicUrlData } = service.storage.from("creative-assets").getPublicUrl(assetPath);
  const nextPhotoUrls = [...photoUrls];
  nextPhotoUrls[slideIndex] = publicUrlData.publicUrl;

  const { error: updateError } = await service
    .from("creatives")
    .update({ status: "pending", brief: { ...brief, slides, photoUrls: nextPhotoUrls } })
    .eq("id", creativeId);
  if (updateError) throw new Error(updateError.message);

  await clearCarouselRender(service, tenantId, creativeId, slideIndex);
  triggerPhotoFrameRender(creativeId);
  revalidatePath(`/calendar/${date}`);
}

/**
 * Always starts a brand-new photo-frame creative for the day, even if one
 * already exists — the explicit "another, separate post today" path. Only
 * becomes the day's featured creative (content_calendar.creative_id) if the
 * slot didn't already have one; otherwise it just joins the day's creative
 * list alongside the others.
 */
export async function createPhotoFrameCreativeAction(formData: FormData): Promise<void> {
  const tenantId = String(formData.get("tenantId") ?? "");
  const date = String(formData.get("date") ?? "");
  const caption = String(formData.get("caption") ?? "").trim();
  if (!tenantId || !date) return;

  const supabase = await createSupabaseServerClient();
  await requireTenantEditor(supabase, tenantId);

  const { data: template } = await supabase
    .from("render_templates")
    .select("id")
    .eq("tenant_id", tenantId)
    .eq("component_ref", "photo-frame")
    .maybeSingle();
  if (!template) throw new Error("Configura tu marco en Marca antes de publicar fotos.");

  const photoUrls = await uploadPhotoFrameSources(supabase, tenantId, formData);

  const service = createServiceRoleClient();

  const { data: existingSlot } = await service
    .from("content_calendar")
    .select("id, creative_id")
    .eq("tenant_id", tenantId)
    .eq("date", date)
    .maybeSingle();

  let slotId = existingSlot?.id;
  if (!slotId) {
    const { data: newSlot, error: slotError } = await service
      .from("content_calendar")
      .insert({
        tenant_id: tenantId,
        date,
        slot_type: photoUrls.length > 1 ? "carousel" : "post",
        theme: caption || "Publicación con marco",
        status: "approved",
        source: { agent: "manual", rationale: "Creado a mano con marco y fotos subidas" },
      })
      .select("id")
      .single();
    if (slotError || !newSlot) throw new Error(slotError?.message ?? "failed to create calendar slot");
    slotId = newSlot.id;
  }

  const { data: creative, error: creativeError } = await service
    .from("creatives")
    .insert({
      tenant_id: tenantId,
      calendar_slot_id: slotId,
      template_id: template.id,
      type: photoUrls.length > 1 ? "carousel" : "image",
      status: "pending",
      brief: { photoUrls, caption },
    })
    .select("id")
    .single();
  if (creativeError || !creative) throw new Error(creativeError?.message ?? "failed to create creative");

  if (!existingSlot?.creative_id) {
    await service.from("content_calendar").update({ creative_id: creative.id }).eq("id", slotId);
  }

  triggerPhotoFrameRender(creative.id);
  revalidatePath(`/calendar/${date}`);
}

/** Same upload shape as uploadPhotoFrameSources, generalized to a named field with its own max count. */
async function uploadStudentShowcasePhotos(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  tenantId: string,
  formData: FormData,
  fieldName: string,
  maxCount: number,
): Promise<string[]> {
  const files = formData
    .getAll(fieldName)
    .filter((entry): entry is File => entry instanceof File && entry.size > 0);
  if (files.length === 0) return [];
  if (files.length > maxCount) {
    throw new Error(`Sube máximo ${maxCount} foto${maxCount > 1 ? "s" : ""} en ese campo.`);
  }

  const urls: string[] = [];
  for (const file of files) {
    const path = `${tenantId}/student-showcase-src-${crypto.randomUUID()}-${file.name}`;
    const { error: uploadError } = await supabase.storage.from("creative-assets").upload(path, file);
    if (uploadError) throw new Error(`failed to upload photo: ${uploadError.message}`);
    const { data } = supabase.storage.from("creative-assets").getPublicUrl(path);
    urls.push(data.publicUrl);
  }
  return urls;
}

/**
 * Builds a "student-showcase" carousel — one slide per group of photos that
 * was actually filled in (work photos, certificate, portrait), in that fixed
 * order, skipping whichever ones are empty. No reordering yet: the design's
 * natural order (work first, certificate, then portrait) covers the real
 * cases so far — revisit if a piece genuinely needs a different order.
 */
export async function createStudentShowcaseCreativeAction(formData: FormData): Promise<void> {
  const tenantId = String(formData.get("tenantId") ?? "");
  const date = String(formData.get("date") ?? "");
  const eventName = String(formData.get("eventName") ?? "").trim();
  const eventYear = String(formData.get("eventYear") ?? "").trim();
  const studentName = String(formData.get("studentName") ?? "").trim();
  const countryCode = String(formData.get("countryCode") ?? "").trim();
  const caption = String(formData.get("caption") ?? "").trim();
  if (!tenantId || !date || !eventName || !eventYear || !studentName) return;

  const supabase = await createSupabaseServerClient();
  await requireTenantEditor(supabase, tenantId);

  const { data: template } = await supabase
    .from("render_templates")
    .select("id")
    .eq("tenant_id", tenantId)
    .eq("component_ref", "student-showcase")
    .maybeSingle();
  if (!template) throw new Error("Esta plantilla no está configurada para tu negocio.");

  const [workPhotos, certificatePhotos, portraitPhotos] = await Promise.all([
    uploadStudentShowcasePhotos(supabase, tenantId, formData, "photosWork", 2),
    uploadStudentShowcasePhotos(supabase, tenantId, formData, "photoCertificate", 1),
    uploadStudentShowcasePhotos(supabase, tenantId, formData, "photoPortrait", 1),
  ]);

  const slides: Array<{ type: "photos" | "certificate" | "portrait"; photoUrls: string[] }> = [];
  if (workPhotos.length > 0) slides.push({ type: "photos", photoUrls: workPhotos });
  if (certificatePhotos.length > 0) slides.push({ type: "certificate", photoUrls: certificatePhotos });
  if (portraitPhotos.length > 0) slides.push({ type: "portrait", photoUrls: portraitPhotos });
  if (slides.length === 0) {
    throw new Error("Sube al menos una foto (trabajos, certificado o retrato).");
  }

  const service = createServiceRoleClient();

  const { data: existingSlot } = await service
    .from("content_calendar")
    .select("id, creative_id")
    .eq("tenant_id", tenantId)
    .eq("date", date)
    .maybeSingle();

  let slotId = existingSlot?.id;
  if (!slotId) {
    const { data: newSlot, error: slotError } = await service
      .from("content_calendar")
      .insert({
        tenant_id: tenantId,
        date,
        slot_type: "carousel",
        theme: `Alumna destacada: ${studentName}`,
        status: "approved",
        source: { agent: "manual", rationale: "Creado a mano con la plantilla Alumna destacada" },
      })
      .select("id")
      .single();
    if (slotError || !newSlot) throw new Error(slotError?.message ?? "failed to create calendar slot");
    slotId = newSlot.id;
  }

  const { data: creative, error: creativeError } = await service
    .from("creatives")
    .insert({
      tenant_id: tenantId,
      calendar_slot_id: slotId,
      template_id: template.id,
      type: "carousel",
      status: "pending",
      brief: {
        eventName,
        eventYear,
        studentName,
        caption,
        slides,
        ...(countryCode ? { countryCode } : {}),
      },
    })
    .select("id")
    .single();
  if (creativeError || !creative) throw new Error(creativeError?.message ?? "failed to create creative");

  if (!existingSlot?.creative_id) {
    await service.from("content_calendar").update({ creative_id: creative.id }).eq("id", slotId);
  }

  triggerPhotoFrameRender(creative.id);
  revalidatePath(`/calendar/${date}`);
}

/**
 * Server Actions are their own reachable endpoint, not gated just because
 * this page's layout calls requireAdmin() — a non-admin could otherwise
 * hit this action directly. Must re-check here too.
 */
export async function updateTenantLimitsAction(formData: FormData): Promise<void> {
  await requireAdmin();

  const tenantId = String(formData.get("tenantId") ?? "");
  if (!tenantId) return;

  const dailyRaw = String(formData.get("tokenLimitDaily") ?? "").trim();
  const perJobRaw = String(formData.get("tokenLimitPerJob") ?? "").trim();
  const hitlMode = String(formData.get("hitlMode") ?? "").trim();

  const service = createServiceRoleClient();
  const { error } = await service
    .from("tenants")
    .update({
      token_limit_daily: dailyRaw ? Number(dailyRaw) : null,
      token_limit_per_job: perJobRaw ? Number(perJobRaw) : null,
      ...(hitlMode ? { hitl_mode: hitlMode } : {}),
    })
    .eq("id", tenantId);

  if (error) throw new Error(error.message);
  revalidatePath("/admin/limits");
}

export async function createPromotionAction(formData: FormData): Promise<void> {
  const tenantId = String(formData.get("tenantId") ?? "");
  const name = String(formData.get("name") ?? "").trim();
  const discountType = String(formData.get("discountType") ?? "");
  const discountValue = Number(formData.get("discountValue") ?? "0");
  const startsAt = String(formData.get("startsAt") ?? "");
  const endsAt = String(formData.get("endsAt") ?? "");
  if (!tenantId || !name || !discountType || !startsAt || !endsAt) return;

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.from("promotions").insert({
    tenant_id: tenantId,
    name,
    discount_type: discountType as "percentage" | "fixed_amount",
    discount_value: discountValue,
    starts_at: new Date(startsAt).toISOString(),
    ends_at: new Date(endsAt).toISOString(),
  });

  if (error) throw new Error(error.message);
  revalidatePath("/catalog");
}

const META_GRAPH_API_VERSION = "v21.0";

/**
 * Fase A of the Meta connection: no OAuth yet (that needs Meta App Review),
 * just a token generated by hand via Graph API Explorer while the tenant's
 * page has our app added as a tester/admin. Both calls just confirm the
 * token actually works and fetch a human-readable name, nothing more.
 */
async function verifyFacebookPage(pageId: string, accessToken: string): Promise<string> {
  const url = `https://graph.facebook.com/${META_GRAPH_API_VERSION}/${pageId}?fields=name&access_token=${encodeURIComponent(accessToken)}`;
  const response = await fetch(url);
  const data = (await response.json()) as { name?: string; error?: { message: string } };
  if (!response.ok || data.error) {
    throw new Error(data.error?.message ?? "no se pudo verificar la página de Facebook");
  }
  return data.name ?? "";
}

async function verifyInstagramAccount(igUserId: string, accessToken: string): Promise<string> {
  const url = `https://graph.facebook.com/${META_GRAPH_API_VERSION}/${igUserId}?fields=username&access_token=${encodeURIComponent(accessToken)}`;
  const response = await fetch(url);
  const data = (await response.json()) as { username?: string; error?: { message: string } };
  if (!response.ok || data.error) {
    throw new Error(data.error?.message ?? "no se pudo verificar la cuenta de Instagram");
  }
  return data.username ?? "";
}

/**
 * The access token is never round-tripped back to the browser (the page
 * never sets it as an input's defaultValue) — leaving the field blank on a
 * resave reuses whatever's already stored instead of overwriting it with
 * an empty string.
 */
export async function upsertSocialConnectionAction(formData: FormData): Promise<void> {
  const tenantId = String(formData.get("tenantId") ?? "");
  const pageId = String(formData.get("pageId") ?? "").trim();
  if (!tenantId || !pageId) return;

  const accessTokenInput = String(formData.get("accessToken") ?? "").trim();
  const instagramBusinessAccountId = String(formData.get("igBusinessAccountId") ?? "").trim() || null;

  const supabase = await createSupabaseServerClient();

  let accessToken = accessTokenInput;
  if (!accessToken) {
    const { data: existing } = await supabase
      .from("social_connections")
      .select("access_token")
      .eq("tenant_id", tenantId)
      .maybeSingle();
    if (!existing) throw new Error("Se necesita un access token para conectar por primera vez.");
    accessToken = existing.access_token;
  }

  let status: "active" | "invalid" = "active";
  let pageName: string | null = null;
  let instagramUsername: string | null = null;
  let lastError: string | null = null;

  try {
    pageName = await verifyFacebookPage(pageId, accessToken);
    if (instagramBusinessAccountId) {
      instagramUsername = await verifyInstagramAccount(instagramBusinessAccountId, accessToken);
    }
  } catch (err) {
    status = "invalid";
    lastError = err instanceof Error ? err.message : String(err);
  }

  const { error } = await supabase.from("social_connections").upsert(
    {
      tenant_id: tenantId,
      page_id: pageId,
      page_name: pageName,
      access_token: accessToken,
      instagram_business_account_id: instagramBusinessAccountId,
      instagram_username: instagramUsername,
      status,
      last_verified_at: new Date().toISOString(),
      last_error: lastError,
    },
    { onConflict: "tenant_id" },
  );

  if (error) throw new Error(error.message);
  revalidatePath("/connections");
}

/** Re-runs verification against the already-stored token — no form fields needed beyond tenantId. */
export async function retestSocialConnectionAction(formData: FormData): Promise<void> {
  const tenantId = String(formData.get("tenantId") ?? "");
  if (!tenantId) return;

  const supabase = await createSupabaseServerClient();
  const { data: existing } = await supabase
    .from("social_connections")
    .select("page_id, access_token, instagram_business_account_id")
    .eq("tenant_id", tenantId)
    .maybeSingle();

  if (!existing) return;

  let status: "active" | "invalid" = "active";
  let pageName: string | null = null;
  let instagramUsername: string | null = null;
  let lastError: string | null = null;

  try {
    pageName = await verifyFacebookPage(existing.page_id, existing.access_token);
    if (existing.instagram_business_account_id) {
      instagramUsername = await verifyInstagramAccount(
        existing.instagram_business_account_id,
        existing.access_token,
      );
    }
  } catch (err) {
    status = "invalid";
    lastError = err instanceof Error ? err.message : String(err);
  }

  const { error } = await supabase
    .from("social_connections")
    .update({
      page_name: pageName,
      instagram_username: instagramUsername,
      status,
      last_verified_at: new Date().toISOString(),
      last_error: lastError,
    })
    .eq("tenant_id", tenantId);

  if (error) throw new Error(error.message);
  revalidatePath("/connections");
}

/**
 * Converts a pending news suggestion into a real content_calendar slot for
 * the chosen date — the News agent itself never touches content_calendar
 * (see apps/workers/src/agents/news.ts), this action is the one
 * human-triggered bridge between "a news item worth using" and actual
 * scheduled content. Same reasoning as createPhotoFrameCreativeAction:
 * content_calendar has no insert policy for authenticated, so this does its
 * own owner/admin check and writes with the service role.
 */
export interface UseNewsSuggestionState {
  error: string | null;
}

/**
 * Bound to a `useActionState` form (see news/use-idea-form.tsx), not a plain
 * `<form action={...}>` — an expected failure like "day already taken" is a
 * normal outcome here (the user free-picks any date), not an exceptional one,
 * so it's returned for inline display instead of thrown. An uncaught throw
 * from a server action renders as a blank "Application error" crash page in
 * production (Next redacts the real message from the client for security),
 * which is unusable for a message the user is specifically meant to read and
 * act on.
 */
export async function useNewsSuggestionAction(
  _prevState: UseNewsSuggestionState,
  formData: FormData,
): Promise<UseNewsSuggestionState> {
  const tenantId = String(formData.get("tenantId") ?? "");
  const suggestionId = String(formData.get("suggestionId") ?? "");
  const date = String(formData.get("date") ?? "");
  if (!tenantId || !suggestionId || !date) return { error: "Falta la fecha." };

  const supabase = await createSupabaseServerClient();
  await requireTenantEditor(supabase, tenantId);

  const service = createServiceRoleClient();

  const { data: suggestion } = await service
    .from("news_suggestions")
    .select("headline, angle, status")
    .eq("id", suggestionId)
    .eq("tenant_id", tenantId)
    .maybeSingle();
  if (!suggestion || suggestion.status !== "pending") return { error: null };

  const { data: tenant } = await service.from("tenants").select("hitl_mode").eq("id", tenantId).single();
  const autoApproveSlot = tenant?.hitl_mode !== "approve-all";

  const { data: slot, error: slotError } = await service
    .from("content_calendar")
    .upsert(
      {
        tenant_id: tenantId,
        date,
        slot_type: "post",
        theme: suggestion.angle,
        status: autoApproveSlot ? "approved" : "draft",
        source: { agent: "news", rationale: suggestion.headline },
      },
      { onConflict: "tenant_id,date", ignoreDuplicates: true },
    )
    .select("id")
    .maybeSingle();
  if (slotError) return { error: slotError.message };

  // Unique tenant_id+date means a day that's already planned silently loses
  // this insert (see upsertContentCalendarSlot's own doc comment) — surfaced
  // here instead of failing silently, since the user explicitly picked this
  // date and would otherwise have no idea why nothing happened.
  if (!slot) {
    return { error: `Ya hay contenido planificado para el ${date}. Elige otro día.` };
  }

  if (autoApproveSlot) {
    const { error: rpcError } = await supabase.rpc("request_creative_generation", {
      target_calendar_slot_id: slot.id,
    });
    if (rpcError) return { error: rpcError.message };
  }

  const { error: updateError } = await service
    .from("news_suggestions")
    .update({ status: "used" })
    .eq("id", suggestionId)
    .eq("tenant_id", tenantId);
  if (updateError) return { error: updateError.message };

  revalidatePath("/news");
  revalidatePath("/calendar");
  return { error: null };
}

export async function dismissNewsSuggestionAction(formData: FormData): Promise<void> {
  const tenantId = String(formData.get("tenantId") ?? "");
  const suggestionId = String(formData.get("suggestionId") ?? "");
  if (!tenantId || !suggestionId) return;

  const supabase = await createSupabaseServerClient();

  const { error } = await supabase
    .from("news_suggestions")
    .update({ status: "dismissed" })
    .eq("id", suggestionId)
    .eq("tenant_id", tenantId);
  if (error) throw new Error(error.message);

  revalidatePath("/news");
}
