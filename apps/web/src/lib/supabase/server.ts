import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { loadConfig } from "@pulso/shared/config";
import type { Database } from "@pulso/db/types";

export async function createSupabaseServerClient() {
  const config = loadConfig();
  const cookieStore = await cookies();

  return createServerClient<Database>(config.SUPABASE_URL, config.SUPABASE_ANON_KEY, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // Called from a Server Component render — middleware already
          // refreshes the session cookie on the next request, so this is safe to ignore.
        }
      },
    },
  });
}
