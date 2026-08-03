import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import type { Database } from "@pulso/db/types";

// Deliberately reads process.env directly instead of @pulso/shared's
// loadConfig() — that validates the full worker env schema (REDIS_URL,
// LMSTUDIO_MODEL, ...), which apps/web has no business requiring just to
// render a page. Same NEXT_PUBLIC_* vars middleware.ts and client.ts
// already use.
export async function createSupabaseServerClient() {
  const cookieStore = await cookies();

  return createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
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
