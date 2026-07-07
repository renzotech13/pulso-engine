"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "./supabase/server";
import { ACTIVE_TENANT_COOKIE } from "./tenant-context";

export async function createTenantAction(formData: FormData): Promise<void> {
  const name = String(formData.get("name") ?? "").trim();
  const slug = String(formData.get("slug") ?? "").trim();
  if (!name || !slug) return;

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("create_tenant_with_owner", {
    tenant_name: name,
    tenant_slug: slug,
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
