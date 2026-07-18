"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createServiceRoleClient } from "@pulso/db/worker";
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
  const { error } = await supabase
    .from("content_calendar")
    .update({
      theme,
      slot_type: slotType as "post" | "carousel" | "story" | "reel",
      status: status as "draft" | "approved" | "skipped",
    })
    .eq("id", slotId);

  if (error) throw new Error(error.message);
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

export async function createProductAction(formData: FormData): Promise<void> {
  const tenantId = String(formData.get("tenantId") ?? "");
  const name = String(formData.get("name") ?? "").trim();
  if (!tenantId || !name) return;

  const priceRaw = String(formData.get("price") ?? "").trim();
  const price = priceRaw ? Number(priceRaw) : null;

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase
    .from("products_services")
    .insert({ tenant_id: tenantId, name, price });

  if (error) throw new Error(error.message);
  revalidatePath("/catalog");
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

  const service = createServiceRoleClient();
  const { error } = await service
    .from("tenants")
    .update({
      token_limit_daily: dailyRaw ? Number(dailyRaw) : null,
      token_limit_per_job: perJobRaw ? Number(perJobRaw) : null,
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
