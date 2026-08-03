import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { loadConfig } from "@pulso/shared/config";
import { ConfigError, TenantIsolationError } from "@pulso/shared/errors";
import type { Database } from "./database.types.js";

export type ServiceRoleClient = SupabaseClient<Database>;

let serviceClient: ServiceRoleClient | undefined;

/**
 * Raw service-role client. Bypasses RLS entirely (Supabase grants BYPASSRLS
 * to service_role) — reserved for infrastructure code that must legitimately
 * operate across tenants, like the outbox dispatcher. Agent code should use
 * `createTenantScopedClient` instead.
 */
export function createServiceRoleClient(): ServiceRoleClient {
  if (serviceClient) return serviceClient;

  const config = loadConfig();
  serviceClient = createClient<Database>(config.SUPABASE_URL, config.SUPABASE_SERVICE_ROLE_KEY, {
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

/**
 * Tenant-scoped handle for agent code. Since service_role bypasses RLS,
 * isolation here is enforced in code, not by Postgres: every method hardcodes
 * the tenant_id filter (reads) or injection (writes) so an agent can never
 * accidentally touch another tenant's rows, even if it tried to.
 */
export interface TenantScopedClient {
  readonly tenantId: string;
  getTenant(): Promise<TenantRow>;
  insertAgentRun(row: Omit<AgentRunInsert, "tenant_id">): Promise<void>;
  insertDecisionLog(row: Omit<DecisionLogInsert, "tenant_id">): Promise<void>;
  /** Global ephemerides (tenant_id null) plus this tenant's custom ones. */
  listEphemerides(): Promise<EphemerisRow[]>;
  listActivePromotions(): Promise<PromotionRow[]>;
  listActiveProducts(): Promise<ProductRow[]>;
  listContentCalendar(fromDate: string, toDate: string): Promise<ContentCalendarRow[]>;
  /**
   * No-ops if a slot already exists for that date (unique tenant_id+date) —
   * never overwrites a Planner or human decision. Returns the row only when
   * the insert actually happened (Postgres omits ignored-conflict rows from
   * RETURNING), so the caller can tell a fresh slot apart from a no-op.
   */
  upsertContentCalendarSlot(row: Omit<ContentCalendarInsert, "tenant_id">): Promise<ContentCalendarRow | null>;
  /**
   * Slots already `approved` (hitl_mode auto-approved them) whose date has
   * arrived, with a creative that's also `approved`, and no successful
   * Facebook publication yet (facebook is always attempted first in
   * publish.ts, so its 'published' row is a reliable "already handled" signal).
   */
  listAutoPublishCandidates(today: string): Promise<Array<{ creativeId: string; calendarSlotId: string }>>;
  getContentCalendarSlotById(id: string): Promise<ContentCalendarRow | null>;
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
  insertPublication(row: Omit<PublicationInsert, "tenant_id">): Promise<PublicationRow>;
  updatePublication(id: string, patch: Omit<PublicationUpdate, "tenant_id">): Promise<void>;
  sumTokensToday(): Promise<number>;
  sumTokensForJob(jobId: string): Promise<number>;
  insertAgentCall(row: Omit<AgentCallInsert, "tenant_id">): Promise<void>;
  /** Ordered oldest-first (nulls — never used — first), so the caller just needs the head of the list. */
  listMediaAssets(kind: "image" | "video"): Promise<MediaAssetRow[]>;
  markMediaAssetUsed(id: string): Promise<void>;
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
        .upsert({ ...row, tenant_id: tenantId }, { onConflict: "tenant_id,date", ignoreDuplicates: true })
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

    async listAutoPublishCandidates(today) {
      const { data, error } = await client
        .from("content_calendar")
        .select("id, creative_id, published_at, creatives!content_calendar_creative_id_fkey(id, status)")
        .eq("tenant_id", tenantId)
        .eq("status", "approved")
        .is("published_at", null)
        .not("creative_id", "is", null)
        .lte("date", today);

      if (error) {
        throw new TenantIsolationError(`failed to list auto-publish candidates for tenant ${tenantId}`, error);
      }

      return (data ?? [])
        .filter((slot) => slot.creatives?.status === "approved")
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
      const { data, error } = await client
        .from("publications")
        .select("*")
        .eq("creative_id", creativeId)
        .eq("platform", platform)
        .in("status", ["published", "scheduled"])
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

    async listMediaAssets(kind) {
      const { data, error } = await client
        .from("media_assets")
        .select("*")
        .eq("tenant_id", tenantId)
        .eq("kind", kind)
        .order("last_used_at", { ascending: true, nullsFirst: true });

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
