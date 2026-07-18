import { getTenantContext } from "@/lib/tenant-context";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createProductAction, createPromotionAction } from "@/lib/actions";

export default async function CatalogPage() {
  const ctx = await getTenantContext();
  const supabase = await createSupabaseServerClient();

  const [{ data: products }, { data: promotions }] = await Promise.all([
    supabase
      .from("products_services")
      .select("*")
      .eq("tenant_id", ctx.tenantId)
      .order("created_at", { ascending: false }),
    supabase
      .from("promotions")
      .select("*")
      .eq("tenant_id", ctx.tenantId)
      .order("created_at", { ascending: false }),
  ]);

  return (
    <div className="space-y-10">
      <h1 className="text-lg font-semibold">Catálogo — {ctx.tenantName}</h1>

      <section>
        <h2 className="mb-3 text-sm font-medium text-neutral-400">Productos y servicios</h2>
        <table className="mb-4 w-full text-sm">
          <thead>
            <tr className="text-left text-neutral-500">
              <th className="pb-2">Nombre</th>
              <th className="pb-2">Precio</th>
              <th className="pb-2">Categoría</th>
            </tr>
          </thead>
          <tbody>
            {(products ?? []).map((p) => (
              <tr key={p.id} className="border-t border-neutral-800">
                <td className="py-2">{p.name}</td>
                <td className="py-2">{p.price ? `S/ ${p.price}` : "—"}</td>
                <td className="py-2">{p.category ?? "—"}</td>
              </tr>
            ))}
            {(!products || products.length === 0) && (
              <tr>
                <td colSpan={3} className="py-2 text-neutral-600">
                  Sin productos todavía.
                </td>
              </tr>
            )}
          </tbody>
        </table>
        <form action={createProductAction} className="flex flex-wrap gap-2">
          <input type="hidden" name="tenantId" value={ctx.tenantId} />
          <input
            name="name"
            required
            placeholder="Nombre"
            className="rounded border border-neutral-700 bg-neutral-900 px-2 py-1 text-sm"
          />
          <input
            name="price"
            type="number"
            step="0.01"
            placeholder="Precio (S/)"
            className="w-32 rounded border border-neutral-700 bg-neutral-900 px-2 py-1 text-sm"
          />
          <button
            type="submit"
            className="rounded bg-indigo-600 px-3 py-1 text-sm font-medium hover:bg-indigo-500"
          >
            Agregar
          </button>
        </form>
      </section>

      <section>
        <h2 className="mb-3 text-sm font-medium text-neutral-400">Promociones</h2>
        <table className="mb-4 w-full text-sm">
          <thead>
            <tr className="text-left text-neutral-500">
              <th className="pb-2">Nombre</th>
              <th className="pb-2">Descuento</th>
              <th className="pb-2">Vigencia</th>
            </tr>
          </thead>
          <tbody>
            {(promotions ?? []).map((promo) => (
              <tr key={promo.id} className="border-t border-neutral-800">
                <td className="py-2">{promo.name}</td>
                <td className="py-2">
                  {promo.discount_type === "percentage"
                    ? `${promo.discount_value}%`
                    : `S/ ${promo.discount_value}`}
                </td>
                <td className="py-2">
                  {promo.starts_at.slice(0, 10)} → {promo.ends_at.slice(0, 10)}
                </td>
              </tr>
            ))}
            {(!promotions || promotions.length === 0) && (
              <tr>
                <td colSpan={3} className="py-2 text-neutral-600">
                  Sin promociones todavía.
                </td>
              </tr>
            )}
          </tbody>
        </table>
        <form action={createPromotionAction} className="flex flex-wrap gap-2">
          <input type="hidden" name="tenantId" value={ctx.tenantId} />
          <input
            name="name"
            required
            placeholder="Nombre"
            className="rounded border border-neutral-700 bg-neutral-900 px-2 py-1 text-sm"
          />
          <select
            name="discountType"
            required
            defaultValue="percentage"
            className="rounded border border-neutral-700 bg-neutral-900 px-2 py-1 text-sm"
          >
            <option value="percentage">%</option>
            <option value="fixed_amount">S/</option>
          </select>
          <input
            name="discountValue"
            type="number"
            step="0.01"
            required
            placeholder="Valor"
            className="w-24 rounded border border-neutral-700 bg-neutral-900 px-2 py-1 text-sm"
          />
          <input
            name="startsAt"
            type="date"
            required
            className="rounded border border-neutral-700 bg-neutral-900 px-2 py-1 text-sm"
          />
          <input
            name="endsAt"
            type="date"
            required
            className="rounded border border-neutral-700 bg-neutral-900 px-2 py-1 text-sm"
          />
          <button
            type="submit"
            className="rounded bg-indigo-600 px-3 py-1 text-sm font-medium hover:bg-indigo-500"
          >
            Agregar
          </button>
        </form>
      </section>
    </div>
  );
}
