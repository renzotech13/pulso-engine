import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createTenantAction } from "@/lib/actions";

export default async function OnboardingPage() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: memberships } = await supabase.from("memberships").select("tenant_id").limit(1);
  if (memberships && memberships.length > 0) redirect("/agents");

  const { data: categories } = await supabase
    .from("business_categories")
    .select("slug, name")
    .order("name");

  return (
    <main className="flex min-h-screen items-center justify-center">
      <form
        action={createTenantAction}
        className="w-full max-w-sm space-y-4 rounded-lg border border-neutral-800 p-8"
      >
        <h1 className="text-xl font-semibold">Crea tu negocio</h1>
        <p className="text-sm text-neutral-400">Este será tu primer tenant en Pulso Engine.</p>
        <input
          name="name"
          required
          placeholder="Nombre del negocio"
          className="w-full rounded border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm"
        />
        <input
          name="slug"
          required
          placeholder="slug-unico"
          pattern="[a-z0-9-]+"
          className="w-full rounded border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm"
        />
        <select
          name="rubro"
          required
          defaultValue=""
          className="w-full rounded border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm"
        >
          <option value="" disabled>
            Rubro del negocio
          </option>
          {(categories ?? []).map((c) => (
            <option key={c.slug} value={c.slug}>
              {c.name}
            </option>
          ))}
        </select>
        <button
          type="submit"
          className="w-full rounded bg-indigo-600 px-3 py-2 text-sm font-medium hover:bg-indigo-500"
        >
          Crear
        </button>
      </form>
    </main>
  );
}
