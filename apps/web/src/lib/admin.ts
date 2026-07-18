import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "./supabase/server";

/**
 * Single-operator allowlist, not a role in the DB — this internal section
 * ("solo para mí" in the spec) is for the one person running the platform,
 * not a per-tenant permission. A comma-separated env var is proportionate;
 * a platform_admins table would be solving a problem nobody has yet.
 */
function adminEmails(): string[] {
  return (process.env.ADMIN_EMAILS ?? "")
    .split(",")
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);
}

/**
 * Redirects to /login (no session) or /agents (logged in but not an admin).
 * Every /admin page/layout must call this before touching cross-tenant data.
 */
export async function requireAdmin(): Promise<{ email: string }> {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user?.email) redirect("/login");

  if (!adminEmails().includes(user.email.toLowerCase())) {
    redirect("/agents");
  }

  return { email: user.email };
}
