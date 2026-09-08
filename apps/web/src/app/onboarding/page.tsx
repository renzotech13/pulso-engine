import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createTenantAction } from "@/lib/actions";
import { readFlash } from "@/lib/flash";
import { Card } from "@/components/ui/card";
import { Field, inputClass, selectClass } from "@/components/ui/field";
import { SubmitButton } from "@/components/submit-button";
import { FlashToast } from "@/components/ui/flash-toast";

export default async function OnboardingPage() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: memberships } = await supabase.from("memberships").select("tenant_id").limit(1);
  if (memberships && memberships.length > 0) redirect("/calendar");

  const [{ data: categories }, flash] = await Promise.all([
    supabase.from("business_categories").select("slug, name").order("name"),
    readFlash(),
  ]);

  return (
    <main className="flex min-h-screen items-center justify-center bg-ink p-4">
      {/* This page lives outside the dashboard layout, so it mounts its own toast:
          createTenantAction flashes its errors (e.g. a slug already taken). */}
      <FlashToast initial={flash} />
      <Card padding="none" className="w-full max-w-sm p-8">
        <form action={createTenantAction} className="space-y-5">
          <div className="space-y-1">
            <p className="eyebrow text-accent-ink">Amplifica Studio</p>
            <h1 className="font-display text-2xl tracking-tight text-fg">Crea tu negocio</h1>
            <p className="text-sm text-fg-2">Este será tu primer negocio en Amplifica Studio.</p>
          </div>

          <div className="space-y-4">
            <Field id="onboarding-name" label="Nombre del negocio" required>
              <input
                id="onboarding-name"
                name="name"
                required
                autoComplete="organization"
                placeholder="Ej. Panadería San Martín"
                className={inputClass}
              />
            </Field>
            <Field
              id="onboarding-slug"
              label="Identificador"
              hint="Solo minúsculas, números y guiones. Ej. panaderia-san-martin"
              required
            >
              <input
                id="onboarding-slug"
                name="slug"
                required
                placeholder="mi-negocio"
                pattern="[a-z0-9-]+"
                autoCapitalize="off"
                spellCheck={false}
                className={inputClass}
              />
            </Field>
            <Field id="onboarding-rubro" label="Rubro" required>
              <select id="onboarding-rubro" name="rubro" required defaultValue="" className={selectClass}>
                <option value="" disabled>
                  Elige el rubro del negocio
                </option>
                {(categories ?? []).map((c) => (
                  <option key={c.slug} value={c.slug}>
                    {c.name}
                  </option>
                ))}
              </select>
            </Field>
          </div>

          <SubmitButton pendingText="Creando…" className="w-full">
            Crear negocio
          </SubmitButton>
        </form>
      </Card>
    </main>
  );
}
