import { createServiceRoleClient } from "@pulso/db/worker";
import { updateTenantLimitsAction } from "@/lib/actions";

export default async function AdminLimitsPage() {
  const service = createServiceRoleClient();
  const { data: tenants } = await service
    .from("tenants")
    .select("id, name, slug, token_limit_daily, token_limit_per_job")
    .order("name");

  return (
    <div>
      <h1 className="mb-1 text-lg font-semibold">Límites de tokens por tenant</h1>
      <p className="mb-6 text-sm text-neutral-500">
        Vacío = sin límite. Con LM Studio no protege gasto, protege que un agente en loop no sature
        la máquina local.
      </p>
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
            <tr key={tenant.id} className="border-t border-neutral-800">
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
                    className="w-32 rounded border border-neutral-700 bg-neutral-900 px-2 py-1"
                  />
                  <input
                    type="number"
                    name="tokenLimitPerJob"
                    min={0}
                    defaultValue={tenant.token_limit_per_job ?? ""}
                    placeholder="sin límite"
                    className="w-32 rounded border border-neutral-700 bg-neutral-900 px-2 py-1"
                  />
                  <button
                    type="submit"
                    className="rounded bg-indigo-600 px-3 py-1 text-xs font-medium hover:bg-indigo-500"
                  >
                    Guardar
                  </button>
                </form>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
