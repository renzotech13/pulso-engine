import { Plug } from "lucide-react";
import { getTenantContext } from "@/lib/tenant-context";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import {
  cancelMetaPendingAction,
  retestSocialConnectionAction,
  selectMetaPageAction,
  upsertSocialConnectionAction,
} from "@/lib/actions";
import { formatDateTime, formatRelative } from "@/lib/labels";
import { META_OAUTH_REDIRECT_URI } from "@/lib/meta-oauth";
import { readMetaPending } from "@/lib/meta-pending";
import { SubmitButton } from "@/components/submit-button";
import { buttonClass } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Field, inputClass } from "@/components/ui/field";
import { PageHeader } from "@/components/ui/page-header";
import { StatusBadge } from "@/components/ui/status-badge";

const META_GRAPH_API_VERSION = "v21.0";
const META_APP_ID = process.env.META_APP_ID ?? "1550590863219497";
const META_SCOPES = [
  "pages_show_list",
  "pages_read_engagement",
  "pages_manage_posts",
  "instagram_basic",
  "instagram_content_publish",
  "business_management",
].join(",");

export default async function ConnectionsPage() {
  const ctx = await getTenantContext();
  const supabase = await createSupabaseServerClient();

  // RLS: viewers can't read social_connections, so `connection` is null for
  // them and we fall through to the same "not connected" state.
  const { data: connection } = await supabase
    .from("social_connections")
    .select("*")
    .eq("tenant_id", ctx.tenantId)
    .maybeSingle();

  const connectUrl = `https://www.facebook.com/${META_GRAPH_API_VERSION}/dialog/oauth?client_id=${META_APP_ID}&redirect_uri=${encodeURIComponent(META_OAUTH_REDIRECT_URI)}&state=${ctx.tenantId}&scope=${META_SCOPES}&response_type=code`;

  const isActive = connection?.status === "active";

  // Only trust a pending selection made for THIS tenant — if it was left
  // over from switching businesses mid-flow, showing it here would be
  // exactly the cross-tenant mix-up this picker exists to prevent.
  const pending = await readMetaPending();
  const pendingPages = pending && pending.tenantId === ctx.tenantId ? pending.pages : null;

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow={ctx.tenantName}
        title="Conexiones"
        description="Conecta tu página de Facebook con un click — el token que genera este flujo es de larga duración y no depende de tu sesión del navegador, a diferencia de uno pegado a mano."
        actions={
          <a href={connectUrl} className={buttonClass("primary")}>
            Conectar con Facebook
          </a>
        }
      />

      {pendingPages && (
        <Card>
          <CardHeader title="¿Cuál de estas páginas es la de este negocio?" />
          <p className="text-sm text-fg-2">
            Tu cuenta de Facebook administra {pendingPages.length} páginas. Elige la que corresponde a{" "}
            {ctx.tenantName} — las demás no se tocan.
          </p>
          <div className="mt-4 space-y-2">
            {pendingPages.map((page) => (
              <form
                key={page.id}
                action={selectMetaPageAction}
                className="flex items-center justify-between gap-4 rounded-lg border border-line p-3"
              >
                <input type="hidden" name="tenantId" value={ctx.tenantId} />
                <input type="hidden" name="pageId" value={page.id} />
                <div>
                  <p className="text-sm font-medium text-fg">{page.name}</p>
                  {page.hasInstagram && <p className="text-xs text-fg-3">Con cuenta de Instagram vinculada</p>}
                </div>
                <SubmitButton variant="secondary" size="sm" pendingText="Conectando…">
                  Elegir
                </SubmitButton>
              </form>
            ))}
          </div>
          <form action={cancelMetaPendingAction} className="mt-3">
            <SubmitButton variant="subtle" size="sm" pendingText="Cancelando…">
              Cancelar
            </SubmitButton>
          </form>
        </Card>
      )}

      {connection ? (
        <Card>
          <CardHeader
            title="Estado de la conexión"
            actions={
              <>
                <StatusBadge tone={isActive ? "green" : "pink"}>
                  {isActive ? "Activa" : "Inválida"}
                </StatusBadge>
                <form action={retestSocialConnectionAction}>
                  <input type="hidden" name="tenantId" value={ctx.tenantId} />
                  <SubmitButton variant="secondary" size="sm" pendingText="Probando…">
                    Volver a probar
                  </SubmitButton>
                </form>
              </>
            }
          />

          <dl className="grid grid-cols-1 gap-x-6 gap-y-3 text-sm sm:grid-cols-3">
            <div>
              <dt className="eyebrow text-fg-3">Página</dt>
              <dd className="mt-0.5 text-fg">{connection.page_name ?? connection.page_id}</dd>
            </div>
            <div>
              <dt className="eyebrow text-fg-3">Instagram</dt>
              <dd className="mt-0.5 text-fg">
                {connection.instagram_username ? (
                  `@${connection.instagram_username}`
                ) : (
                  <span className="text-fg-3">Sin cuenta vinculada</span>
                )}
              </dd>
            </div>
            <div>
              <dt className="eyebrow text-fg-3">Verificada</dt>
              <dd className="mt-0.5 text-fg">
                {connection.last_verified_at ? (
                  <span title={formatDateTime(connection.last_verified_at)}>
                    {formatRelative(connection.last_verified_at)}
                  </span>
                ) : (
                  <span className="text-fg-3">Nunca</span>
                )}
              </dd>
            </div>
          </dl>

          {!isActive && connection.last_error && (
            <p className="mt-4 text-sm text-danger">{connection.last_error}</p>
          )}
        </Card>
      ) : (
        <EmptyState
          icon={<Plug size={28} />}
          title="Todavía no hay una página conectada"
          description="Conecta tu página de Facebook para que Amplifica pueda publicar por ti. Si solo tienes permiso de lectura, pídele a un administrador del negocio que lo haga."
          action={
            <a href={connectUrl} className={buttonClass("primary", "sm")}>
              Conectar con Facebook
            </a>
          }
        />
      )}

      <Card padding="sm">
        <details>
          <summary className="cursor-pointer text-sm font-medium text-fg-2 transition-colors hover:text-fg">
            Conectar a mano con un token (avanzado)
          </summary>
          <p className="mt-3 text-sm text-fg-2">
            Solo si el botón de arriba no funciona: agrega la app de Amplifica Studio como tester/admin
            de la página en Meta for Developers, genera un Page Access Token vía Graph API Explorer,
            y pégalo abajo.
          </p>

          <form
            action={upsertSocialConnectionAction}
            className="mt-4 grid grid-cols-1 gap-4 border-t border-line pt-4 sm:grid-cols-2"
          >
            <input type="hidden" name="tenantId" value={ctx.tenantId} />

            <Field id="pageId" label="ID de la página" required>
              <input
                id="pageId"
                name="pageId"
                required
                defaultValue={connection?.page_id ?? ""}
                placeholder="123456789012345"
                className={inputClass}
              />
            </Field>

            <Field id="igBusinessAccountId" label="Cuenta de Instagram (opcional)">
              <input
                id="igBusinessAccountId"
                name="igBusinessAccountId"
                defaultValue={connection?.instagram_business_account_id ?? ""}
                placeholder="17841400000000000"
                className={inputClass}
              />
            </Field>

            <Field
              id="accessToken"
              label="Token de acceso"
              className="sm:col-span-2"
              hint={connection ? "Ya hay un token guardado — deja el campo en blanco para no cambiarlo." : undefined}
            >
              <input
                id="accessToken"
                name="accessToken"
                type="password"
                autoComplete="off"
                placeholder={
                  connection ? "Guardado — deja en blanco para no cambiarlo" : "Pega el token generado en Graph API Explorer"
                }
                className={inputClass}
              />
            </Field>

            <div className="sm:col-span-2">
              <SubmitButton pendingText="Verificando…">Guardar y verificar</SubmitButton>
            </div>
          </form>
        </details>
      </Card>
    </div>
  );
}
