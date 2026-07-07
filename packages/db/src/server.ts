import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { loadConfig } from "@pulso/shared/config";
import type { Database } from "./database.types.js";

export type SupabaseServerClient = SupabaseClient<Database>;

/**
 * Client scoped to a single end user's session. RLS does all the tenant
 * isolation here — every query is filtered by whatever `private.user_tenant_ids()`
 * resolves to for this JWT. Use this in web/api request handlers, never in workers.
 */
export function createUserClient(accessToken: string): SupabaseServerClient {
  const config = loadConfig();

  return createClient<Database>(config.SUPABASE_URL, config.SUPABASE_ANON_KEY, {
    global: {
      headers: { Authorization: `Bearer ${accessToken}` },
    },
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}
