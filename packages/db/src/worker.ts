import { fileURLToPath } from "node:url";
import path from "node:path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { config as loadDotenv } from "dotenv";
import { ConfigError, TenantIsolationError } from "@pulso/shared/errors";
import type { Database } from "./database.types.js";
import { limaToday } from "@pulso/shared/time";

// This file always lives at <repo-root>/packages/db/src/worker.ts in the
// workspace, so this resolves to the repo root regardless of which app
// imports it or what its own cwd is — same approach @pulso/shared/config
// used to provide as a side effect of being imported, lost when this file
// stopped importing loadConfig() (see createServiceRoleClient below). Only
// matters for standalone tsx scripts; Next.js and apps/workers' main.ts both
// already populate process.env before this runs, and dotenv never overwrites
// an existing key.
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
loadDotenv({ path: path.join(repoRoot, ".env") });

export type ServiceRoleClient = SupabaseClient<Database>;

let serviceClient: ServiceRoleClient | undefined;

/**
 * Raw service-role client. Bypasses RLS entirely (Supabase grants BYPASSRLS
 * to service_role) — reserved for infrastructure code that must legitimately
 * operate across tenants, like the outbox dispatcher. Agent code should use
 * `createTenantScopedClient` instead.
 *
 * Reads SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY directly instead of going
 * through @pulso/shared's loadConfig() — that validates the FULL
 * worker-oriented schema (REDIS_URL, LMSTUDIO_MODEL, ...), which apps/web
 * (the other real caller, for the manual "Publicar" button) has no reason to
 * set. Same reasoning as apps/web's own now-redundant local service client.
 */
export function createServiceRoleClient(): ServiceRoleClient {
  if (serviceClient) return serviceClient;

  const url = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRoleKey) {
    throw new ConfigError("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must both be set");
  }

  serviceClient = createClient<Database>(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return serviceClient;
}

type AgentRunInsert = Database["public"]["Tables"]["agent_runs"]["Insert"];
type DecisionLogInsert = Database["public"]["Tables"]["decision_log"]["Insert"];
type TenantRow = Database["public"]["Tables"]["tenants"]["Row"];
type EphemerisRow = Database["public"]["Tables"]["ephemerides"]["Row"];
type PromotionRow = Database["public"]["Tables"]["promotions"]["Row"];
type ProductRow = Database["public"]["Tables"]["products_services"]["Row"];
type ContentCalendarRow = Database["public"]["Tables"]["content_calendar"]["Row"];
type ContentCalendarInsert = Database["public"]["Tables"]["content_calendar"]["Insert"];
type AgentsRegistryRow = Database["public"]["Tables"]["agents_registry"]["Row"];
type AgentCallInsert = Database["public"]["Tables"]["agent_calls"]["Insert"];
type RenderTemplateRow = Database["public"]["Tables"]["render_templates"]["Row"];
type CreativeRow = Database["public"]["Tables"]["creatives"]["Row"];
type CreativeInsert = Database["public"]["Tables"]["creatives"]["Insert"];
type SocialConnectionRow = Database["public"]["Tables"]["social_connections"]["Row"];
type PublicationRow = Database["public"]["Tables"]["publications"]["Row"];
type PublicationInsert = Database["public"]["Tables"]["publications"]["Insert"];
type PublicationUpdate = Database["public"]["Tables"]["publications"]["Update"];
type MediaAssetRow = Database["public"]["Tables"]["media_assets"]["Row"];
type MediaAssetUpdate = Database["public"]["Tables"]["media_assets"]["Update"];
type SiteTargetRow = Database["public"]["Tables"]["site_targets"]["Row"];
type ArticleRow = Database["public"]["Tables"]["articles"]["Row"];
type ArticleInsert = Database["public"]["Tables"]["articles"]["Insert"];
type ArticleUpdate = Database["public"]["Tables"]["articles"]["Update"];
type BrandKitRow = Database["public"]["Tables"]["brand_kits"]["Row"];
type VideoProjectRow = Database["public"]["Tables"]["video_projects"]["Row"];
type VideoProjectUpdate = Database["public"]["Tables"]["video_projects"]["Update"];
type VideoAssetRow = Database["public"]["Tables"]["video_assets"]["Row"];
type VideoAssetUpdate = Database["public"]["Tables"]["video_assets"]["Update"];
type VideoProjectVideoRow = Database["public"]["Tables"]["video_project_videos"]["Row"];
type VideoProjectVideoInsert = Database["public"]["Tables"]["video_project_videos"]["Insert"];
type VideoProjectVideoUpdate = Database["public"]["Tables"]["video_project_videos"]["Update"];
type VideoPresetRow = Database["public"]["Tables"]["video_presets"]["Row"];

/**
 * Tenant-scoped handle for agent code. Since service_role bypasses RLS,
 * isolation here is enforced in code, not by Postgres: every method hardcodes
 * the tenant_id filter (reads) or injection (writes) so an agent can never
 * accidentally touch another tenant's rows, even if it tried to.
 */
export interface TenantScopedClient {
  readonly tenantId: string;
  getTenant(): Promise<TenantRow>;
  /** null when the tenant never set one up — every field is optional there. */
  getBrandKit(): Promise<BrandKitRow | null>;
  insertAgentRun(row: Omit<AgentRunInsert, "tenant_id">): Promise<void>;
  insertDecisionLog(row: Omit<DecisionLogInsert, "tenant_id">): Promise<void>;
  /** Global ephemerides (tenant_id null) plus this tenant's custom ones. */
  listEphemerides(): Promise<EphemerisRow[]>;
  listActivePromotions(): Promise<PromotionRow[]>;
  listActiveProducts(): Promise<ProductRow[]>;
  listContentCalendar(fromDate: string, toDate: string): Promise<ContentCalendarRow[]>;
  /**
   * No-ops if a slot already exists for that date AND index (unique
   * tenant_id+date+slot_index) — never overwrites a Planner or human
   * decision. Returns the row only when the insert actually happened
   * (Postgres omits ignored-conflict rows from RETURNING), so the caller can
   * tell a fresh slot apart from a no-op.
   */
  upsertContentCalendarSlot(row: Omit<ContentCalendarInsert, "tenant_id">): Promise<ContentCalendarRow | null>;
  /**
   * Slots already `approved` (hitl_mode auto-approved them) whose moment has
   * arrived, with a creative that's also `approved`, and no successful
   * Facebook publication yet (facebook is always attempted first in
   * publish.ts, so its 'published' row is a reliable "already handled" signal).
   *
   * "Moment" is date + `publish_hour`: a slot dated today only counts once
   * `nowHour` (Lima time) has reached its hour, which is what keeps a
   * tenant's two daily posts from going out back to back. A slot with no
   * publish_hour, or one from a past date (catching up on stragglers),
   * counts as soon as its date arrives — the behaviour every tenant had
   * before slots got hours.
   */
  listAutoPublishCandidates(
    today: string,
    nowHour: number,
  ): Promise<Array<{ creativeId: string; calendarSlotId: string }>>;
  getContentCalendarSlotById(id: string): Promise<ContentCalendarRow | null>;
  /** Used when tenants.reels_paused reassigns an already-approved 'reel' slot to 'post' instead of leaving it stuck. */
  updateCalendarSlotType(calendarSlotId: string, slotType: ContentCalendarRow["slot_type"]): Promise<void>;
  setCalendarSlotCreative(calendarSlotId: string, creativeId: string): Promise<void>;
  /**
   * Marks a calendar SLOT (not the current creative) as published, once,
   * ever — creatives get hard-deleted on regenerate (and take their
   * `publications` rows with them via ON DELETE CASCADE), so this is the
   * only thing that survives regeneration to remember "this day already
   * went out for real". No-ops if already set (first-published-at wins).
   */
  markCalendarSlotPublished(calendarSlotId: string): Promise<void>;
  /** Tenant-specific override takes priority over the global registration of the same name. */
  getAgentRegistration(agentName: string): Promise<AgentsRegistryRow | null>;
  /** Same override-then-global lookup as getAgentRegistration — no per-tenant overrides seeded yet, but the shape matches in case one ever is. */
  getRenderTemplateByName(name: string): Promise<RenderTemplateRow | null>;
  getCreativeByCalendarSlotId(calendarSlotId: string): Promise<CreativeRow | null>;
  insertCreative(row: Omit<CreativeInsert, "tenant_id">): Promise<CreativeRow>;
  getCreativeById(id: string): Promise<CreativeRow | null>;
  updateCreativeStatus(id: string, status: CreativeRow["status"]): Promise<void>;
  getSocialConnection(): Promise<SocialConnectionRow | null>;
  /** 'published' means it genuinely went out; 'scheduled' (Facebook-only) means Meta already knows about it and will fire it itself — both mean "don't post this platform again". */
  getHandledPublication(creativeId: string, platform: "facebook" | "instagram"): Promise<PublicationRow | null>;
  /** null means a concurrent run already has an active row for this creative+platform (the unique index in migration 22 rejected the insert) — the caller should treat that exactly like getHandledPublication finding one. */
  insertPublication(row: Omit<PublicationInsert, "tenant_id">): Promise<PublicationRow | null>;
  updatePublication(id: string, patch: Omit<PublicationUpdate, "tenant_id">): Promise<void>;
  sumTokensToday(): Promise<number>;
  sumTokensForJob(jobId: string): Promise<number>;
  insertAgentCall(row: Omit<AgentCallInsert, "tenant_id">): Promise<void>;
  /** Ordered oldest-first (nulls — never used — first), so the caller just needs the head of the list. */
  listMediaAssets(kind: "image" | "video"): Promise<MediaAssetRow[]>;
  markMediaAssetUsed(id: string): Promise<void>;
  /**
   * Newest first. Reads `brief.photoSource` (stamped by creative.ts) from
   * the latest creatives so the bank-vs-Gemini rule can avoid streaks.
   * Creatives from before that stamp existed simply don't count.
   */
  listRecentPhotoSources(limit: number): Promise<Array<{ source: string; assetId?: string }>>;
  /** Successful Gemini image generations today (Lima day), from agent_calls. */
  countGeminiImagesToday(): Promise<number>;
  /** null when the tenant has no website wired up — most of them. */
  getSiteTarget(): Promise<SiteTargetRow | null>;
  getArticleByCalendarSlotId(calendarSlotId: string): Promise<ArticleRow | null>;
  insertArticle(row: Omit<ArticleInsert, "tenant_id">): Promise<ArticleRow>;
  updateArticle(id: string, patch: Omit<ArticleUpdate, "tenant_id">): Promise<void>;
  /**
   * Every article that already has a page on disk, newest first — the blog
   * index is rewritten in full on each publish rather than patched, so it
   * can never drift from what was actually written.
   */
  listPublishedArticles(): Promise<ArticleRow[]>;

  // --- Editor de Video (Fase 3) ------------------------------------------

  getVideoProject(id: string): Promise<VideoProjectRow | null>;
  updateVideoProject(id: string, patch: Omit<VideoProjectUpdate, "tenant_id">): Promise<void>;
  listVideoAssets(projectId: string): Promise<VideoAssetRow[]>;
  updateVideoAsset(id: string, patch: Omit<VideoAssetUpdate, "tenant_id">): Promise<void>;
  listVideoProjectVideos(projectId: string): Promise<VideoProjectVideoRow[]>;
  insertVideoProjectVideo(row: Omit<VideoProjectVideoInsert, "tenant_id">): Promise<VideoProjectVideoRow>;
  updateVideoProjectVideo(id: string, patch: Omit<VideoProjectVideoUpdate, "tenant_id">): Promise<void>;
  /** Tenant's own preset if the id belongs to them, else the global one (tenant_id null) — same "override or global" shape as getAgentRegistration. */
  getVideoPreset(id: string): Promise<VideoPresetRow | null>;
}

export function createTenantScopedClient(
  tenantId: string,
  client: ServiceRoleClient = createServiceRoleClient(),
): TenantScopedClient {
  return {
    tenantId,

    async getTenant() {
      const { data, error } = await client
        .from("tenants")
        .select("*")
        .eq("id", tenantId)
        .single();

      if (error || !data) {
        throw new TenantIsolationError(`tenant ${tenantId} not found`, error);
      }
      return data;
    },

    async getBrandKit() {
      const { data } = await client.from("brand_kits").select("*").eq("tenant_id", tenantId).maybeSingle();
      return data ?? null;
    },

    async insertAgentRun(row) {
      const { error } = await client.from("agent_runs").insert({ ...row, tenant_id: tenantId });
      if (error) {
        throw new TenantIsolationError(`failed to insert agent_run for tenant ${tenantId}`, error);
      }
    },

    async insertDecisionLog(row) {
      const { error } = await client
        .from("decision_log")
        .insert({ ...row, tenant_id: tenantId });
      if (error) {
        throw new TenantIsolationError(
          `failed to insert decision_log for tenant ${tenantId}`,
          error,
        );
      }
    },

    async listEphemerides() {
      const { data, error } = await client
        .from("ephemerides")
        .select("*")
        .or(`tenant_id.is.null,tenant_id.eq.${tenantId}`);

      if (error) {
        throw new TenantIsolationError(`failed to list ephemerides for tenant ${tenantId}`, error);
      }
      return data ?? [];
    },

    async listActivePromotions() {
      const { data, error } = await client
        .from("promotions")
        .select("*")
        .eq("tenant_id", tenantId)
        .eq("active", true);

      if (error) {
        throw new TenantIsolationError(`failed to list promotions for tenant ${tenantId}`, error);
      }
      return data ?? [];
    },

    async listActiveProducts() {
      const { data, error } = await client
        .from("products_services")
        .select("*")
        .eq("tenant_id", tenantId)
        .eq("active", true);

      if (error) {
        throw new TenantIsolationError(`failed to list products for tenant ${tenantId}`, error);
      }
      return data ?? [];
    },

    async listContentCalendar(fromDate, toDate) {
      const { data, error } = await client
        .from("content_calendar")
        .select("*")
        .eq("tenant_id", tenantId)
        .gte("date", fromDate)
        .lte("date", toDate);

      if (error) {
        throw new TenantIsolationError(`failed to list content_calendar for tenant ${tenantId}`, error);
      }
      return data ?? [];
    },

    async upsertContentCalendarSlot(row) {
      const { data, error } = await client
        .from("content_calendar")
        .upsert(
          { ...row, tenant_id: tenantId },
          { onConflict: "tenant_id,date,slot_index", ignoreDuplicates: true },
        )
        .select("*")
        .maybeSingle();

      if (error) {
        throw new TenantIsolationError(
          `failed to upsert content_calendar slot for tenant ${tenantId}`,
          error,
        );
      }
      return data ?? null;
    },

    async listAutoPublishCandidates(today, nowHour) {
      const { data, error } = await client
        .from("content_calendar")
        .select(
          "id, date, publish_hour, creative_id, published_at, creatives!content_calendar_creative_id_fkey(id, status)",
        )
        .eq("tenant_id", tenantId)
        .eq("status", "approved")
        .eq("hold_publish", false)
        .is("published_at", null)
        .not("creative_id", "is", null)
        .lte("date", today);

      if (error) {
        throw new TenantIsolationError(`failed to list auto-publish candidates for tenant ${tenantId}`, error);
      }

      return (data ?? [])
        .filter((slot) => slot.creatives?.status === "approved")
        .filter((slot) => slot.date < today || slot.publish_hour === null || slot.publish_hour <= nowHour)
        .map((slot) => ({ creativeId: slot.creative_id as string, calendarSlotId: slot.id }));
    },

    async markCalendarSlotPublished(calendarSlotId) {
      const { error } = await client
        .from("content_calendar")
        .update({ published_at: new Date().toISOString() })
        .eq("id", calendarSlotId)
        .eq("tenant_id", tenantId)
        .is("published_at", null);

      if (error) {
        throw new TenantIsolationError(
          `failed to mark calendar slot ${calendarSlotId} published for tenant ${tenantId}`,
          error,
        );
      }
    },

    async getContentCalendarSlotById(id) {
      const { data, error } = await client
        .from("content_calendar")
        .select("*")
        .eq("id", id)
        .eq("tenant_id", tenantId)
        .maybeSingle();

      if (error) {
        throw new TenantIsolationError(`failed to get content_calendar slot ${id} for tenant ${tenantId}`, error);
      }
      return data;
    },

    async updateCalendarSlotType(calendarSlotId, slotType) {
      const { error } = await client
        .from("content_calendar")
        .update({ slot_type: slotType })
        .eq("id", calendarSlotId)
        .eq("tenant_id", tenantId);

      if (error) {
        throw new TenantIsolationError(
          `failed to update calendar slot ${calendarSlotId} type for tenant ${tenantId}`,
          error,
        );
      }
    },

    async setCalendarSlotCreative(calendarSlotId, creativeId) {
      const { error } = await client
        .from("content_calendar")
        .update({ creative_id: creativeId })
        .eq("id", calendarSlotId)
        .eq("tenant_id", tenantId);

      if (error) {
        throw new TenantIsolationError(
          `failed to set creative_id on content_calendar slot ${calendarSlotId} for tenant ${tenantId}`,
          error,
        );
      }
    },

    async getAgentRegistration(agentName) {
      const { data, error } = await client
        .from("agents_registry")
        .select("*")
        .eq("name", agentName)
        .or(`tenant_id.eq.${tenantId},tenant_id.is.null`);

      if (error) {
        throw new TenantIsolationError(
          `failed to look up agent "${agentName}" for tenant ${tenantId}`,
          error,
        );
      }
      const rows = data ?? [];
      return rows.find((r) => r.tenant_id === tenantId) ?? rows.find((r) => r.tenant_id === null) ?? null;
    },

    async getRenderTemplateByName(name) {
      const { data, error } = await client
        .from("render_templates")
        .select("*")
        .eq("name", name)
        .or(`tenant_id.eq.${tenantId},tenant_id.is.null`);

      if (error) {
        throw new TenantIsolationError(
          `failed to look up render_template "${name}" for tenant ${tenantId}`,
          error,
        );
      }
      const rows = data ?? [];
      return rows.find((r) => r.tenant_id === tenantId) ?? rows.find((r) => r.tenant_id === null) ?? null;
    },

    async getCreativeByCalendarSlotId(calendarSlotId) {
      const { data, error } = await client
        .from("creatives")
        .select("*")
        .eq("calendar_slot_id", calendarSlotId)
        .eq("tenant_id", tenantId)
        .maybeSingle();

      if (error) {
        throw new TenantIsolationError(
          `failed to look up creative for calendar slot ${calendarSlotId} in tenant ${tenantId}`,
          error,
        );
      }
      return data;
    },

    async insertCreative(row) {
      const { data, error } = await client
        .from("creatives")
        .insert({ ...row, tenant_id: tenantId })
        .select("*")
        .single();

      if (error || !data) {
        throw new TenantIsolationError(`failed to insert creative for tenant ${tenantId}`, error);
      }
      return data;
    },

    async getCreativeById(id) {
      const { data, error } = await client
        .from("creatives")
        .select("*")
        .eq("id", id)
        .eq("tenant_id", tenantId)
        .maybeSingle();

      if (error) {
        throw new TenantIsolationError(`failed to get creative ${id} for tenant ${tenantId}`, error);
      }
      return data;
    },

    async updateCreativeStatus(id, status) {
      const { error } = await client
        .from("creatives")
        .update({ status })
        .eq("id", id)
        .eq("tenant_id", tenantId);

      if (error) {
        throw new TenantIsolationError(`failed to update creative ${id} status for tenant ${tenantId}`, error);
      }
    },

    async getSocialConnection() {
      const { data, error } = await client
        .from("social_connections")
        .select("*")
        .eq("tenant_id", tenantId)
        .maybeSingle();

      if (error) {
        throw new TenantIsolationError(`failed to get social connection for tenant ${tenantId}`, error);
      }
      return data;
    },

    async getHandledPublication(creativeId, platform) {
      // Includes 'pending' — not just the terminal 'published'/'scheduled'
      // states — because a second concurrent run for the same creative
      // (the publish worker runs at concurrency: 2, and more than one code
      // path can fire publish.requested for the same full-auto creative)
      // needs to see a first run's row *before* that first run has actually
      // finished calling Meta's API, or both proceed to publish for real.
      // Confirmed in production: the same creative posted twice to both
      // Facebook and Instagram within under a second. This narrows the race
      // window a lot but isn't airtight on its own — see the partial unique
      // index in migration 00000000000022, which is the actual atomic guard.
      const { data, error } = await client
        .from("publications")
        .select("*")
        .eq("creative_id", creativeId)
        .eq("platform", platform)
        .in("status", ["pending", "published", "scheduled"])
        .eq("tenant_id", tenantId)
        .maybeSingle();

      if (error) {
        throw new TenantIsolationError(
          `failed to look up ${platform} publication for creative ${creativeId} in tenant ${tenantId}`,
          error,
        );
      }
      return data;
    },

    async insertPublication(row) {
      const { data, error } = await client
        .from("publications")
        .insert({ ...row, tenant_id: tenantId })
        .select("*")
        .single();

      if (error?.code === "23505") return null;
      if (error || !data) {
        throw new TenantIsolationError(`failed to insert publication for tenant ${tenantId}`, error);
      }
      return data;
    },

    async updatePublication(id, patch) {
      const { error } = await client
        .from("publications")
        .update(patch)
        .eq("id", id)
        .eq("tenant_id", tenantId);

      if (error) {
        throw new TenantIsolationError(`failed to update publication ${id} for tenant ${tenantId}`, error);
      }
    },

    async sumTokensToday() {
      const startOfDay = new Date();
      startOfDay.setUTCHours(0, 0, 0, 0);

      const { data, error } = await client
        .from("agent_calls")
        .select("input_tokens, output_tokens")
        .eq("tenant_id", tenantId)
        .gte("created_at", startOfDay.toISOString());

      if (error) {
        throw new TenantIsolationError(`failed to sum today's tokens for tenant ${tenantId}`, error);
      }
      return (data ?? []).reduce((sum, row) => sum + row.input_tokens + row.output_tokens, 0);
    },

    async sumTokensForJob(jobId) {
      const { data, error } = await client
        .from("agent_calls")
        .select("input_tokens, output_tokens")
        .eq("tenant_id", tenantId)
        .eq("job_id", jobId);

      if (error) {
        throw new TenantIsolationError(`failed to sum job tokens for tenant ${tenantId}`, error);
      }
      return (data ?? []).reduce((sum, row) => sum + row.input_tokens + row.output_tokens, 0);
    },

    async insertAgentCall(row) {
      const { error } = await client.from("agent_calls").insert({ ...row, tenant_id: tenantId });
      if (error) {
        throw new TenantIsolationError(`failed to insert agent_call for tenant ${tenantId}`, error);
      }
    },

    async listRecentPhotoSources(limit) {
      const { data, error } = await client
        .from("creatives")
        .select("brief")
        .eq("tenant_id", tenantId)
        .order("created_at", { ascending: false })
        .limit(limit);

      if (error) {
        throw new TenantIsolationError(`failed to list recent photo sources for tenant ${tenantId}`, error);
      }
      return (data ?? []).flatMap((row) => {
        const brief = row.brief as { photoSource?: unknown; photoAssetId?: unknown } | null;
        if (!brief || typeof brief.photoSource !== "string") return [];
        return [
          {
            source: brief.photoSource,
            ...(typeof brief.photoAssetId === "string" ? { assetId: brief.photoAssetId } : {}),
          },
        ];
      });
    },

    async countGeminiImagesToday() {
      // Lima day, not UTC — publish hours and calendar dates are Lima too.
      const dayStart = new Date(`${limaToday()}T00:00:00-05:00`).toISOString();
      const { count, error } = await client
        .from("agent_calls")
        .select("id", { count: "exact", head: true })
        .eq("tenant_id", tenantId)
        .eq("agent_name", "gemini-image")
        .eq("status", "success")
        .gte("created_at", dayStart);

      if (error) {
        throw new TenantIsolationError(`failed to count Gemini images for tenant ${tenantId}`, error);
      }
      return count ?? 0;
    },

    async listMediaAssets(kind) {
      // Secondary orders make a fresh bank (every last_used_at null) rotate
      // deterministically instead of in whatever order Postgres feels like.
      const { data, error } = await client
        .from("media_assets")
        .select("*")
        .eq("tenant_id", tenantId)
        .eq("kind", kind)
        .order("last_used_at", { ascending: true, nullsFirst: true })
        .order("created_at", { ascending: true })
        .order("id", { ascending: true });

      if (error) {
        throw new TenantIsolationError(`failed to list media_assets for tenant ${tenantId}`, error);
      }
      return data ?? [];
    },

    async markMediaAssetUsed(id) {
      const { error } = await client
        .from("media_assets")
        .update({ last_used_at: new Date().toISOString() })
        .eq("id", id)
        .eq("tenant_id", tenantId);

      if (error) {
        throw new TenantIsolationError(`failed to mark media_asset ${id} used for tenant ${tenantId}`, error);
      }
    },

    async getSiteTarget() {
      const { data, error } = await client
        .from("site_targets")
        .select("*")
        .eq("tenant_id", tenantId)
        .maybeSingle();

      if (error) {
        throw new TenantIsolationError(`failed to get site_target for tenant ${tenantId}`, error);
      }
      return data;
    },

    async getArticleByCalendarSlotId(calendarSlotId) {
      const { data, error } = await client
        .from("articles")
        .select("*")
        .eq("calendar_slot_id", calendarSlotId)
        .eq("tenant_id", tenantId)
        .maybeSingle();

      if (error) {
        throw new TenantIsolationError(
          `failed to look up article for calendar slot ${calendarSlotId} in tenant ${tenantId}`,
          error,
        );
      }
      return data;
    },

    async insertArticle(row) {
      const { data, error } = await client
        .from("articles")
        .insert({ ...row, tenant_id: tenantId })
        .select()
        .single();

      if (error || !data) {
        throw new TenantIsolationError(`failed to insert article for tenant ${tenantId}`, error);
      }
      return data;
    },

    async updateArticle(id, patch) {
      const { error } = await client
        .from("articles")
        .update(patch)
        .eq("id", id)
        .eq("tenant_id", tenantId);

      if (error) {
        throw new TenantIsolationError(`failed to update article ${id} for tenant ${tenantId}`, error);
      }
    },

    async listPublishedArticles() {
      const { data, error } = await client
        .from("articles")
        .select("*")
        .eq("tenant_id", tenantId)
        .eq("status", "published")
        .order("published_at", { ascending: false, nullsFirst: false })
        .order("created_at", { ascending: false });

      if (error) {
        throw new TenantIsolationError(`failed to list articles for tenant ${tenantId}`, error);
      }
      return data ?? [];
    },

    async getVideoProject(id) {
      const { data, error } = await client
        .from("video_projects")
        .select("*")
        .eq("id", id)
        .eq("tenant_id", tenantId)
        .maybeSingle();

      if (error) {
        throw new TenantIsolationError(`failed to get video_project ${id} for tenant ${tenantId}`, error);
      }
      return data;
    },

    async updateVideoProject(id, patch) {
      const { error } = await client
        .from("video_projects")
        .update(patch)
        .eq("id", id)
        .eq("tenant_id", tenantId);

      if (error) {
        throw new TenantIsolationError(`failed to update video_project ${id} for tenant ${tenantId}`, error);
      }
    },

    async listVideoAssets(projectId) {
      const { data, error } = await client
        .from("video_assets")
        .select("*")
        .eq("project_id", projectId)
        .eq("tenant_id", tenantId)
        .order("created_at", { ascending: true });

      if (error) {
        throw new TenantIsolationError(`failed to list video_assets for project ${projectId}`, error);
      }
      return data ?? [];
    },

    async updateVideoAsset(id, patch) {
      const { error } = await client
        .from("video_assets")
        .update(patch)
        .eq("id", id)
        .eq("tenant_id", tenantId);

      if (error) {
        throw new TenantIsolationError(`failed to update video_asset ${id} for tenant ${tenantId}`, error);
      }
    },

    async listVideoProjectVideos(projectId) {
      const { data, error } = await client
        .from("video_project_videos")
        .select("*")
        .eq("project_id", projectId)
        .eq("tenant_id", tenantId)
        .order("script_id", { ascending: true });

      if (error) {
        throw new TenantIsolationError(`failed to list video_project_videos for project ${projectId}`, error);
      }
      return data ?? [];
    },

    async insertVideoProjectVideo(row) {
      const { data, error } = await client
        .from("video_project_videos")
        .insert({ ...row, tenant_id: tenantId })
        .select()
        .single();

      if (error || !data) {
        throw new TenantIsolationError(`failed to insert video_project_video for tenant ${tenantId}`, error);
      }
      return data;
    },

    async updateVideoProjectVideo(id, patch) {
      const { error } = await client
        .from("video_project_videos")
        .update(patch)
        .eq("id", id)
        .eq("tenant_id", tenantId);

      if (error) {
        throw new TenantIsolationError(`failed to update video_project_video ${id} for tenant ${tenantId}`, error);
      }
    },

    async getVideoPreset(id) {
      const { data, error } = await client.from("video_presets").select("*").eq("id", id).maybeSingle();

      if (error) {
        throw new TenantIsolationError(`failed to get video_preset ${id}`, error);
      }
      if (!data) return null;
      if (data.tenant_id !== null && data.tenant_id !== tenantId) return null;
      return data;
    },
  };
}

/**
 * Prompts are global (not tenant-scoped), so this reads via the raw
 * service-role client rather than a TenantScopedClient.
 */
export async function getActivePrompt(
  client: ServiceRoleClient,
  name: string,
): Promise<string> {
  const { data, error } = await client
    .from("prompts")
    .select("template")
    .eq("name", name)
    .eq("is_active", true)
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error || !data) {
    throw new ConfigError(`no active prompt found for "${name}"`, error);
  }
  return data.template;
}

/**
 * Photos the tagger tick still owes a description, across every tenant —
 * oldest first, and never one that already burned its attempts.
 */
export async function listUntaggedMediaAssets(
  client: ServiceRoleClient,
  limit: number,
): Promise<MediaAssetRow[]> {
  const { data, error } = await client
    .from("media_assets")
    .select("*")
    .eq("kind", "image")
    .is("tagged_at", null)
    .lt("tag_attempts", 3)
    .order("created_at", { ascending: true })
    .limit(limit);

  if (error) throw new TenantIsolationError("failed to list untagged media assets", error);
  return data ?? [];
}

export async function updateMediaAssetTags(
  client: ServiceRoleClient,
  id: string,
  patch: MediaAssetUpdate,
): Promise<void> {
  const { error } = await client.from("media_assets").update(patch).eq("id", id);
  if (error) throw new TenantIsolationError(`failed to update media asset ${id}`, error);
}
