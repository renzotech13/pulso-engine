import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createTenantAction } from "@/lib/actions";
import { Card } from "@/components/ui/card";
import { inputClass } from "@/components/ui/field";
import { Button } from "@/components/ui/button";

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
    <main className="flex min-h-screen items-center justify-center bg-ink-950 p-4">
      <Card className="w-full max-w-sm p-8">
        <form action={createTenantAction} className="space-y-4">
          <h1 className="font-display text-xl text-neutral-100">Crea tu negocio</h1>
          <p className="text-sm text-neutral-400">Este será tu primer tenant en Pulso Engine.</p>
          <input name="name" required placeholder="Nombre del negocio" className={inputClass} />
          <input
            name="slug"
            required
            placeholder="slug-unico"
            pattern="[a-z0-9-]+"
            className={inputClass}
          />
          <select name="rubro" required defaultValue="" className={inputClass}>
            <option value="" disabled>
              Rubro del negocio
            </option>
            {(categories ?? []).map((c) => (
              <option key={c.slug} value={c.slug}>
                {c.name}
              </option>
            ))}
          </select>
          <Button type="submit" className="w-full">
            Crear
          </Button>
        </form>
      </Card>
    </main>
  );
}
