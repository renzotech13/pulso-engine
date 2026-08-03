import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@pulso/db/types";

let client: SupabaseClient<Database> | undefined;

/**
 * apps/web's own service-role client — deliberately not @pulso/db/worker's
 * createServiceRoleClient, which routes through loadConfig() and therefore
 * requires REDIS_URL/LMSTUDIO_MODEL too (real requirements for
 * apps/workers, irrelevant for a dashboard that only ever talks to
 * Supabase). Bypasses RLS — only for actions that already did their own
 * membership/role check.
 */
export function createServiceRoleClient(): SupabaseClient<Database> {
  if (client) return client;
  client = createClient<Database>(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return client;
}
