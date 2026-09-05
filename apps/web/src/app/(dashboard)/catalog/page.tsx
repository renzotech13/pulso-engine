import { ImageOff, Package, Tag } from "lucide-react";
import { getTenantContext } from "@/lib/tenant-context";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createProductAction, createPromotionAction } from "@/lib/actions";
import { MediaDropzone } from "@/components/media-dropzone";
import { SubmitButton } from "@/components/submit-button";
import { Card, CardHeader } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Field, inputClass, selectClass, textareaClass } from "@/components/ui/field";
import { PageHeader } from "@/components/ui/page-header";

// "5 sep 2026" for a promotion's YYYY-MM-DD boundary. Promotions are calendar
// days, not instants, so we pin noon Lima to avoid a timezone off-by-one.
const promoDayFormatter = new Intl.DateTimeFormat("es-PE", {
  timeZone: "America/Lima",
  day: "numeric",
  month: "short",
  year: "numeric",
});

function formatPromoDay(value: string): string {
  const day = value.slice(0, 10);
  const date = new Date(`${day}T12:00:00-05:00`);
  return Number.isNaN(date.getTime()) ? day : promoDayFormatter.format(date);
}

function formatPrice(price: number | string | null | undefined): string {
  if (price === null || price === undefined || price === "") return "Sin precio";
  return `S/ ${price}`;
}

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

  const productList = products ?? [];
  const promotionList = promotions ?? [];

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow={ctx.tenantName}
        title="Catálogo"
        description="El material de acá es lo que el Planificador usa para inspirarse — mientras más fotos y videos reales tenga cada producto, mejor le sale el contenido."
      />

      <Card>
        <CardHeader
          title="Servicios/Productos"
          description={
            productList.length > 0
              ? `${productList.length} ${productList.length === 1 ? "ítem" : "ítems"} en el catálogo`
              : "Lo que ofreces, con fotos y videos reales si los tienes"
          }
        />

        {productList.length > 0 ? (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {productList.map((product) => {
              const cover = product.photo_urls[0];
              const photoCount = product.photo_urls.length;
              const videoCount = product.video_urls.length;
              const showMedia = photoCount > 1 || videoCount > 0;
              return (
                <div
                  key={product.id}
                  className="overflow-hidden rounded-xl border border-ink-700 bg-ink-800/60"
                >
                  <div className="flex h-32 items-center justify-center bg-ink-800">
                    {cover ? (
                      <img src={cover} alt={product.name} className="h-full w-full object-cover" />
                    ) : (
                      <ImageOff size={28} className="text-neutral-600" aria-hidden="true" />
                    )}
                  </div>
                  <div className="p-3">
                    <p className="font-medium text-neutral-100">{product.name}</p>
                    <p className="mt-0.5 text-sm text-pulso-accent">{formatPrice(product.price)}</p>
                    {product.category && (
                      <p className="mt-1 text-xs text-neutral-500">{product.category}</p>
                    )}
                    {showMedia && (
                      <p className="mt-2 text-xs text-neutral-600">
                        {photoCount > 1 && `${photoCount} fotos`}
                        {photoCount > 1 && videoCount > 0 && " · "}
                        {videoCount > 0 && `${videoCount} ${videoCount === 1 ? "video" : "videos"}`}
                      </p>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <EmptyState
            icon={<Package size={28} />}
            title="Todavía no hay productos ni servicios"
            description="Agrega el primero abajo — con fotos si tienes, para que el Planificador tenga material real."
          />
        )}

        <form action={createProductAction} className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2">
          <input type="hidden" name="tenantId" value={ctx.tenantId} />
          <Field id="product-name" label="Nombre" required>
            <input
              id="product-name"
              name="name"
              required
              placeholder="Nombre del producto o servicio"
              className={inputClass}
            />
          </Field>
          <Field id="product-price" label="Precio (S/)">
            <input
              id="product-price"
              name="price"
              type="number"
              step="0.01"
              min="0"
              placeholder="120"
              className={inputClass}
            />
          </Field>
          <Field id="product-category" label="Categoría">
            <input
              id="product-category"
              name="category"
              placeholder="Ej: Cortes, Servicios"
              className={inputClass}
            />
          </Field>
          <Field id="product-description" label="Descripción" hint="Qué incluye, duración, etc.">
            <textarea
              id="product-description"
              name="description"
              rows={3}
              placeholder="Qué incluye, duración, etc."
              className={textareaClass}
            />
          </Field>
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
            <SubmitButton variant="primary" pendingText="Subiendo…">
              Agregar producto
            </SubmitButton>
          </div>
        </form>
      </Card>

      <Card>
        <CardHeader
          title="Promociones"
          description={
            promotionList.length > 0
              ? `${promotionList.length} ${promotionList.length === 1 ? "promoción" : "promociones"} registradas`
              : "Descuentos con fecha de inicio y fin"
          }
        />

        {promotionList.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wide text-neutral-500">
                  <th className="pb-2 pr-4 font-medium">Nombre</th>
                  <th className="pb-2 pr-4 font-medium">Descuento</th>
                  <th className="pb-2 font-medium">Vigencia</th>
                </tr>
              </thead>
              <tbody>
                {promotionList.map((promo) => (
                  <tr key={promo.id} className="border-t border-ink-700">
                    <td className="py-2.5 pr-4 text-neutral-100">{promo.name}</td>
                    <td className="py-2.5 pr-4 text-pulso-accent">
                      {promo.discount_type === "percentage"
                        ? `${promo.discount_value}%`
                        : `S/ ${promo.discount_value}`}
                    </td>
                    <td className="whitespace-nowrap py-2.5 text-neutral-400">
                      {formatPromoDay(promo.starts_at)} → {formatPromoDay(promo.ends_at)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState
            icon={<Tag size={28} />}
            title="Sin promociones todavía"
            description="Registra un descuento con su vigencia y el Planificador lo tendrá en cuenta al armar el calendario."
          />
        )}

        <form
          action={createPromotionAction}
          className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5"
        >
          <input type="hidden" name="tenantId" value={ctx.tenantId} />
          <Field id="promo-name" label="Nombre" required className="sm:col-span-2 lg:col-span-5">
            <input
              id="promo-name"
              name="name"
              required
              placeholder="Ej: 20% de descuento"
              className={inputClass}
            />
          </Field>
          <Field id="promo-type" label="Tipo" required>
            <select
              id="promo-type"
              name="discountType"
              required
              defaultValue="percentage"
              className={selectClass}
            >
              <option value="percentage">%</option>
              <option value="fixed_amount">S/</option>
            </select>
          </Field>
          <Field id="promo-value" label="Valor" required>
            <input
              id="promo-value"
              name="discountValue"
              type="number"
              step="0.01"
              min="0"
              required
              className={inputClass}
            />
          </Field>
          <Field id="promo-starts" label="Desde" required>
            <input id="promo-starts" name="startsAt" type="date" required className={inputClass} />
          </Field>
          <Field id="promo-ends" label="Hasta" required>
            <input id="promo-ends" name="endsAt" type="date" required className={inputClass} />
          </Field>
          <div className="flex items-end sm:col-span-2 lg:col-span-1">
            <SubmitButton variant="primary" pendingText="Guardando…" className="w-full">
              Agregar
            </SubmitButton>
          </div>
        </form>
      </Card>
    </div>
  );
}
