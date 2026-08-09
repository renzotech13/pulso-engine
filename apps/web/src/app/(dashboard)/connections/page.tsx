import { headers } from "next/headers";
import { getTenantContext } from "@/lib/tenant-context";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { retestSocialConnectionAction, upsertSocialConnectionAction } from "@/lib/actions";
import { inputClass as fieldClass, labelClass } from "@/components/ui/field";
import { Badge } from "@/components/ui/badge";

const META_GRAPH_API_VERSION = "v21.0";
const META_APP_ID = process.env.META_APP_ID ?? "1550590863219497";
const META_SCOPES = [
  "pages_show_list",
  "pages_read_engagement",
  "pages_manage_posts",
  "pages_manage_metadata",
  "instagram_basic",
  "instagram_content_publish",
  "business_management",
].join(",");

interface ConnectionsPageProps {
  searchParams: Promise<{ meta_connected?: string; meta_error?: string; meta_other_pages?: string }>;
}

export default async function ConnectionsPage({ searchParams }: ConnectionsPageProps) {
  const sp = await searchParams;
  const ctx = await getTenantContext();
  const supabase = await createSupabaseServerClient();

  const { data: connection } = await supabase
    .from("social_connections")
    .select("*")
    .eq("tenant_id", ctx.tenantId)
    .maybeSingle();

  const headersList = await headers();
  const host = headersList.get("host");
  const protocol = host?.startsWith("localhost") ? "http" : "https";
  const redirectUri = `${protocol}://${host}/api/meta/callback`;
  const connectUrl = `https://www.facebook.com/${META_GRAPH_API_VERSION}/dialog/oauth?client_id=${META_APP_ID}&redirect_uri=${encodeURIComponent(redirectUri)}&state=${ctx.tenantId}&scope=${META_SCOPES}&response_type=code`;

  return (
    <div className="space-y-8">
      <div>
        <p className="mb-1 font-display text-xs uppercase tracking-[0.2em] text-pulso-accent">
          Conexiones
        </p>
        <h1 className="font-display text-2xl font-semibold">{ctx.tenantName}</h1>
        <p className="mt-1 max-w-2xl text-sm text-neutral-500">
          Conecta tu página de Facebook con un click — el token que genera este flujo es de larga
          duración y no depende de tu sesión del navegador, a diferencia de uno pegado a mano.
        </p>
        <a
          href={connectUrl}
          className="mt-4 inline-flex items-center gap-2 rounded-lg bg-pulso-primary px-4 py-2 text-sm font-medium text-white transition-colors duration-300 ease-in-out hover:bg-pulso-accent"
        >
          Conectar con Facebook
        </a>
        {sp.meta_connected && (
          <p className="mt-3 text-sm text-status-green">
            Página conectada correctamente.
            {sp.meta_other_pages && (
              <> También administras: {sp.meta_other_pages} — para usar otra, pégala abajo manualmente.</>
            )}
          </p>
        )}
        {sp.meta_error && <p className="mt-3 text-sm text-status-pink">Error de Meta: {sp.meta_error}</p>}
      </div>

      <details className="rounded-xl border border-ink-700 bg-ink-900 p-4 text-sm text-neutral-400">
        <summary className="cursor-pointer font-medium text-neutral-300">
          Conectar a mano con un token (avanzado)
        </summary>
        <p className="mt-3">
          Solo si el botón de arriba no funciona: agrega la app de Pulso Engine como tester/admin
          de la página en Meta for Developers, genera un Page Access Token vía Graph API Explorer,
          y pégalo abajo.
        </p>
      </details>

      {connection && (
        <div className="flex flex-wrap items-center gap-3 rounded-xl border border-ink-700 bg-ink-900 p-4">
          <Badge variant={connection.status === "active" ? "accent" : "pink"}>
            {connection.status === "active" ? "Activa" : "Inválida"}
          </Badge>
          {connection.page_name && (
            <span className="text-sm text-neutral-300">Página: {connection.page_name}</span>
          )}
          {connection.instagram_username && (
            <span className="text-sm text-neutral-300">
              Instagram: @{connection.instagram_username}
            </span>
          )}
          {connection.last_verified_at && (
            <span className="text-xs text-neutral-600">
              Verificado {new Date(connection.last_verified_at).toLocaleString("es-PE")}
            </span>
          )}
          {connection.status === "invalid" && connection.last_error && (
            <p className="w-full text-sm text-status-pink">{connection.last_error}</p>
          )}
          <form action={retestSocialConnectionAction} className="ml-auto">
            <input type="hidden" name="tenantId" value={ctx.tenantId} />
            <button
              type="submit"
              className="rounded-lg border border-ink-700 px-3 py-1.5 text-xs font-medium text-neutral-300 transition-colors duration-300 ease-in-out hover:border-pulso-accent/60 hover:text-neutral-100"
            >
              Volver a probar
            </button>
          </form>
        </div>
      )}

      <form
        action={upsertSocialConnectionAction}
        className="grid grid-cols-1 gap-4 rounded-xl border border-ink-700 bg-ink-900 p-5 sm:grid-cols-2"
      >
        <input type="hidden" name="tenantId" value={ctx.tenantId} />

        <div>
          <label className={labelClass}>Page ID (Facebook)</label>
          <input
            name="pageId"
            required
            defaultValue={connection?.page_id ?? ""}
            placeholder="123456789012345"
            className={fieldClass}
          />
        </div>

        <div>
          <label className={labelClass}>Instagram Business Account ID (opcional)</label>
          <input
            name="igBusinessAccountId"
            defaultValue={connection?.instagram_business_account_id ?? ""}
            placeholder="17841400000000000"
            className={fieldClass}
          />
        </div>

        <div className="sm:col-span-2">
          <label className={labelClass}>Page Access Token</label>
          <input
            name="accessToken"
            type="password"
            placeholder={
              connection ? "Guardado — deja en blanco para no cambiarlo" : "Pega el token generado en Graph API Explorer"
            }
            className={fieldClass}
          />
        </div>

        <div className="sm:col-span-2">
          <button
            type="submit"
            className="rounded-lg bg-pulso-primary px-4 py-2 text-sm font-medium text-white transition-colors duration-300 ease-in-out hover:bg-pulso-accent"
          >
            Guardar y verificar
          </button>
        </div>
      </form>
    </div>
  );
}
