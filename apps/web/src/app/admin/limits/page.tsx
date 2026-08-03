import { createServiceRoleClient } from "@/lib/supabase/service";
import { updateTenantLimitsAction } from "@/lib/actions";
import { Card } from "@/components/ui/card";
import { inputClass } from "@/components/ui/field";

export default async function AdminLimitsPage() {
  const service = createServiceRoleClient();
  const { data: tenants } = await service
    .from("tenants")
    .select("id, name, slug, token_limit_daily, token_limit_per_job, hitl_mode")
    .order("name");

  return (
    <div className="space-y-6">
      <div>
        <p className="mb-1 font-display text-xs uppercase tracking-[0.2em] text-pulso-accent">
          Panel interno
        </p>
        <h1 className="font-display text-2xl font-semibold">Límites y automatización por tenant</h1>
        <p className="mt-1 text-sm text-neutral-500">
          Límites de tokens: vacío = sin límite (con LM Studio no protege gasto, protege que un agente
          en loop no sature la máquina local). Modo: quién aprueba cada paso — en{" "}
          <span className="text-neutral-300">full-auto</span> el sistema publica solo, sin ningún
          click, en las redes conectadas de ese tenant.
        </p>
      </div>

      <Card className="overflow-hidden p-5">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-neutral-500">
              <th className="pb-2">Tenant</th>
              <th className="pb-2">Límite diario (tokens)</th>
              <th className="pb-2">Límite por job (tokens)</th>
              <th className="pb-2"></th>
            </tr>
          </thead>
          <tbody>
            {(tenants ?? []).map((tenant) => (
              <tr key={tenant.id} className="border-t border-ink-700">
                <td className="py-2">
                  {tenant.name} <span className="text-neutral-500">({tenant.slug})</span>
                </td>
                <td className="py-2" colSpan={3}>
                  <form action={updateTenantLimitsAction} className="flex items-center gap-2">
                    <input type="hidden" name="tenantId" value={tenant.id} />
                    <input
                      type="number"
                      name="tokenLimitDaily"
                      min={0}
                      defaultValue={tenant.token_limit_daily ?? ""}
                      placeholder="sin límite"
                      className={`w-32 ${inputClass}`}
                    />
                    <input
                      type="number"
                      name="tokenLimitPerJob"
                      min={0}
                      defaultValue={tenant.token_limit_per_job ?? ""}
                      placeholder="sin límite"
                      className={`w-32 ${inputClass}`}
                    />
                    <select
                      name="hitlMode"
                      defaultValue={tenant.hitl_mode}
                      title="Nivel de automatización: qué se aprueba solo vs. a mano"
                      className={inputClass}
                    >
                      <option value="approve-all">approve-all (todo manual)</option>
                      <option value="approve-creatives">approve-creatives (slot auto, creative manual)</option>
                      <option value="full-auto">full-auto (publica solo)</option>
                    </select>
                    <button
                      type="submit"
                      className="rounded-lg bg-pulso-primary px-3 py-1.5 text-xs font-medium text-white transition-colors duration-300 ease-in-out hover:bg-pulso-accent"
                    >
                      Guardar
                    </button>
                  </form>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
