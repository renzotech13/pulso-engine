import { getTenantContext } from "@/lib/tenant-context";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createProductAction, createPromotionAction } from "@/lib/actions";
import { MediaDropzone } from "@/components/media-dropzone";
import { inputClass as fieldClass, labelClass } from "@/components/ui/field";

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
    <div className="space-y-12">
      <div>
        <p className="mb-1 font-display text-xs uppercase tracking-[0.2em] text-pulso-accent">
          Catálogo
        </p>
        <h1 className="font-display text-2xl font-semibold">{ctx.tenantName}</h1>
        <p className="mt-1 text-sm text-neutral-500">
          El material de acá es lo que el Planner usa para inspirarse — mientras más fotos y
          videos reales tenga cada producto, mejor le sale el contenido.
        </p>
      </div>

      <section>
        <h2 className="mb-4 font-display text-sm font-semibold text-neutral-300">
          Productos y servicios
        </h2>

        {products && products.length > 0 ? (
          <div className="mb-6 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {products.map((product) => (
              <div
                key={product.id}
                className="overflow-hidden rounded-xl border border-ink-700 bg-ink-900"
              >
                <div className="flex h-32 items-center justify-center bg-ink-800">
                  {product.photo_urls[0] ? (
                    <img
                      src={product.photo_urls[0]}
                      alt={product.name}
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <span className="text-3xl opacity-30">✦</span>
                  )}
                </div>
                <div className="p-3">
                  <p className="font-medium text-neutral-100">{product.name}</p>
                  <p className="mt-0.5 text-sm text-pulso-accent">
                    {product.price ? `S/ ${product.price}` : "Sin precio"}
                  </p>
                  {product.category && (
                    <p className="mt-1 text-xs text-neutral-500">{product.category}</p>
                  )}
                  {(product.photo_urls.length > 1 || product.video_urls.length > 0) && (
                    <p className="mt-2 text-xs text-neutral-600">
                      {product.photo_urls.length > 1 && `${product.photo_urls.length} fotos`}
                      {product.photo_urls.length > 1 && product.video_urls.length > 0 && " · "}
                      {product.video_urls.length > 0 && `${product.video_urls.length} videos`}
                    </p>
                  )}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="mb-6 text-sm text-neutral-600">
            Todavía no hay productos — agrega el primero abajo, con fotos si tienes.
          </p>
        )}

        <form
          action={createProductAction}
          className="grid grid-cols-1 gap-4 rounded-xl border border-ink-700 bg-ink-900 p-4 sm:grid-cols-2"
        >
          <input type="hidden" name="tenantId" value={ctx.tenantId} />
          <div>
            <label className={labelClass}>Nombre</label>
            <input name="name" required placeholder="Nombre del producto o servicio" className={fieldClass} />
          </div>
          <div>
            <label className={labelClass}>Precio (S/)</label>
            <input name="price" type="number" step="0.01" placeholder="120" className={fieldClass} />
          </div>
          <div>
            <label className={labelClass}>Categoría</label>
            <input name="category" placeholder="Ej: Categorías, Servicios" className={fieldClass} />
          </div>
          <div>
            <label className={labelClass}>Descripción</label>
            <input name="description" placeholder="Qué incluye, duración, etc." className={fieldClass} />
          </div>
          <div className="sm:col-span-2">
            <MediaDropzone
              name="photos"
              accept="image/*"
              label="Fotos"
              hint="Arrastra fotos acá o haz click para elegir"
            />
          </div>
          <div className="sm:col-span-2">
            <MediaDropzone
              name="videos"
              accept="video/*"
              label="Videos"
              hint="Arrastra videos acá o haz click para elegir"
            />
          </div>
          <div className="sm:col-span-2">
            <button
              type="submit"
              className="rounded-lg bg-pulso-primary px-4 py-2 text-sm font-medium text-white transition-colors duration-300 ease-in-out hover:bg-pulso-accent"
            >
              Agregar producto
            </button>
          </div>
        </form>
      </section>

      <section>
        <h2 className="mb-4 font-display text-sm font-semibold text-neutral-300">Promociones</h2>
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
              <tr key={promo.id} className="border-t border-ink-800">
                <td className="py-2">{promo.name}</td>
                <td className="py-2 text-pulso-accent">
                  {promo.discount_type === "percentage"
                    ? `${promo.discount_value}%`
                    : `S/ ${promo.discount_value}`}
                </td>
                <td className="py-2 text-neutral-400">
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
        <form
          action={createPromotionAction}
          className="grid grid-cols-2 gap-3 rounded-xl border border-ink-700 bg-ink-900 p-4 sm:grid-cols-5"
        >
          <input type="hidden" name="tenantId" value={ctx.tenantId} />
          <div className="col-span-2 sm:col-span-2">
            <label className={labelClass}>Nombre</label>
            <input name="name" required placeholder="Ej: 20% de descuento" className={fieldClass} />
          </div>
          <div>
            <label className={labelClass}>Tipo</label>
            <select name="discountType" required defaultValue="percentage" className={fieldClass}>
              <option value="percentage">%</option>
              <option value="fixed_amount">S/</option>
            </select>
          </div>
          <div>
            <label className={labelClass}>Valor</label>
            <input name="discountValue" type="number" step="0.01" required className={fieldClass} />
          </div>
          <div>
            <label className={labelClass}>Desde</label>
            <input name="startsAt" type="date" required className={fieldClass} />
          </div>
          <div>
            <label className={labelClass}>Hasta</label>
            <input name="endsAt" type="date" required className={fieldClass} />
          </div>
          <div className="col-span-2 flex items-end sm:col-span-1">
            <button
              type="submit"
              className="w-full rounded-lg bg-pulso-primary px-4 py-2 text-sm font-medium text-white transition-colors duration-300 ease-in-out hover:bg-pulso-accent"
            >
              Agregar
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}
