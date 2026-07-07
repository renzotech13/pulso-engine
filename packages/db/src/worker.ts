import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { loadConfig } from "@pulso/shared/config";
import { TenantIsolationError } from "@pulso/shared/errors";
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
  };
}
