import { createServiceRoleClient } from "@/lib/supabase/service";
import { updateTenantLimitsAction } from "@/lib/actions";
import { SELECT_OPTIONS } from "@/lib/labels";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { SubmitButton } from "@/components/submit-button";
import { inputClass, selectClass } from "@/components/ui/field";
import { Gauge } from "lucide-react";

const COLUMNS = ["Negocio", "Tokens/día", "Tokens/trabajo", "Modo", "% IA", "IA/día", "Reels"];

export default async function AdminLimitsPage() {
  const service = createServiceRoleClient();
  const { data: tenants } = await service
    .from("tenants")
    .select(
      "id, name, slug, token_limit_daily, token_limit_per_job, hitl_mode, gemini_share, gemini_daily_image_budget, reels_paused",
    )
    .order("name");

  const rows = tenants ?? [];

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Operador"
        title="Límites por tenant"
        description="Tokens: vacío = sin límite (con LM Studio no protege gasto, protege que un agente en loop no sature la máquina). Modo: quién aprueba cada paso — en Automático el sistema publica solo en las redes conectadas de ese negocio."
      />

      <Card padding="none" className="overflow-hidden">
        {rows.length === 0 ? (
          <div className="p-5">
            <EmptyState
              icon={<Gauge size={28} />}
              title="Sin negocios registrados"
              description="Cuando exista al menos un tenant, sus límites aparecerán aquí."
            />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[880px] text-sm">
              <thead>
                <tr className="border-b border-line text-left eyebrow text-fg-3">
                  {COLUMNS.map((col) => (
                    <th key={col} scope="col" className="px-4 py-3 font-medium">
                      {col}
                    </th>
                  ))}
                  <th scope="col" className="px-4 py-3 font-medium">
                    <span className="sr-only">Acción</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((tenant) => {
                  // One form per row, living in the action cell: the inputs in
                  // the other cells point at it through the `form` attribute,
                  // which keeps the markup a valid table while the SubmitButton
                  // stays inside the form for useFormStatus.
                  const formId = `limits-${tenant.id}`;
                  return (
                    <tr key={tenant.id} className="border-b border-line last:border-b-0 hover:bg-surface-2/40">
                      <td className="px-4 py-3 align-middle">
                        <p className="font-medium text-fg">{tenant.name}</p>
                        <p className="text-xs text-fg-3">{tenant.slug}</p>
                      </td>
                      <td className="px-2 py-3 align-middle">
                        <input
                          form={formId}
                          type="number"
                          name="tokenLimitDaily"
                          min={0}
                          defaultValue={tenant.token_limit_daily ?? ""}
                          placeholder="Sin límite"
                          aria-label={`Tokens por día de ${tenant.name}`}
                          className={`min-w-[7rem] ${inputClass}`}
                        />
                      </td>
                      <td className="px-2 py-3 align-middle">
                        <input
                          form={formId}
                          type="number"
                          name="tokenLimitPerJob"
                          min={0}
                          defaultValue={tenant.token_limit_per_job ?? ""}
                          placeholder="Sin límite"
                          aria-label={`Tokens por trabajo de ${tenant.name}`}
                          className={`min-w-[7rem] ${inputClass}`}
                        />
                      </td>
                      <td className="px-2 py-3 align-middle">
                        <select
                          form={formId}
                          name="hitlMode"
                          defaultValue={tenant.hitl_mode}
                          title="Nivel de automatización: qué se aprueba solo y qué a mano"
                          aria-label={`Modo de ${tenant.name}`}
                          className={`min-w-[11rem] ${selectClass}`}
                        >
                          {SELECT_OPTIONS.hitlMode.map((opt) => (
                            <option key={opt.value} value={opt.value}>
                              {opt.text}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="px-2 py-3 align-middle">
                        <input
                          form={formId}
                          type="number"
                          name="geminiShare"
                          min={0}
                          max={100}
                          defaultValue={tenant.gemini_share ?? ""}
                          placeholder="Banco"
                          title="Porcentaje objetivo de publicaciones con imagen generada (vacío = solo banco de fotos)"
                          aria-label={`Porcentaje de imágenes IA de ${tenant.name}`}
                          className={`min-w-[5rem] ${inputClass}`}
                        />
                      </td>
                      <td className="px-2 py-3 align-middle">
                        <input
                          form={formId}
                          type="number"
                          name="geminiDailyImageBudget"
                          min={0}
                          defaultValue={tenant.gemini_daily_image_budget ?? ""}
                          placeholder="Sin tope"
                          title="Máximo de imágenes generadas con éxito por día (vacío = sin tope)"
                          aria-label={`Imágenes IA por día de ${tenant.name}`}
                          className={`min-w-[5rem] ${inputClass}`}
                        />
                      </td>
                      <td className="px-2 py-3 align-middle text-center">
                        <input
                          form={formId}
                          type="checkbox"
                          name="reelsPaused"
                          defaultChecked={tenant.reels_paused}
                          title="Pausa la generación de reels — el sistema publica un post en su lugar. No afecta posts, carruseles ni historias."
                          aria-label={`Pausar reels de ${tenant.name}`}
                          className="h-4 w-4 accent-danger"
                        />
                      </td>
                      <td className="px-4 py-3 text-right align-middle">
                        <form id={formId} action={updateTenantLimitsAction}>
                          <input type="hidden" name="tenantId" value={tenant.id} />
                          <SubmitButton size="sm" pendingText="Guardando…">
                            Guardar
                          </SubmitButton>
                        </form>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
