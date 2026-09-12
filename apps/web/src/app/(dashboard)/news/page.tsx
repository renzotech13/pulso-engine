import { ExternalLink, Newspaper } from "lucide-react";
import { getTenantContext } from "@/lib/tenant-context";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { dismissNewsSuggestionAction } from "@/lib/actions";
import { formatRelative, limaToday } from "@/lib/labels";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { StatusBadge } from "@/components/ui/status-badge";
import { SubmitButton } from "@/components/submit-button";
import { UseIdeaForm } from "./use-idea-form";

/**
 * Starting tomorrow (Lima), the first date that still has a free slot. A day
 * holds as many slots as the tenant has publish hours (none = a single one,
 * same rule as useNewsSuggestionAction), so a day is only "taken" once it has
 * that many rows — proposing a half-full day as the default is fine.
 */
function nextFreeDate(slotsPerDay: ReadonlyMap<string, number>, capacity: number, today: string): string {
  const d = new Date(`${today}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  for (let i = 0; i < 90; i++) {
    const iso = d.toISOString().slice(0, 10);
    if ((slotsPerDay.get(iso) ?? 0) < capacity) return iso;
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return d.toISOString().slice(0, 10);
}

function pendingLabel(count: number): string {
  if (count === 0) return "Sin ideas pendientes por ahora.";
  if (count === 1) return "1 idea pendiente.";
  return `${count} ideas pendientes.`;
}

export default async function NewsPage() {
  const ctx = await getTenantContext();
  const supabase = await createSupabaseServerClient();

  const [{ data: suggestions }, { data: recentDecided }, { data: plannedSlots }, { data: tenant }] =
    await Promise.all([
      supabase
        .from("news_suggestions")
        .select("*")
        .eq("tenant_id", ctx.tenantId)
        .eq("status", "pending")
        .order("created_at", { ascending: false }),
      supabase
        .from("news_suggestions")
        .select("*")
        .eq("tenant_id", ctx.tenantId)
        .in("status", ["used", "dismissed"])
        .order("created_at", { ascending: false })
        .limit(10),
      supabase.from("content_calendar").select("date").eq("tenant_id", ctx.tenantId),
      supabase.from("tenants").select("publish_hours, hitl_mode").eq("id", ctx.tenantId).maybeSingle(),
    ]);

  const slotsPerDay = new Map<string, number>();
  for (const slot of plannedSlots ?? []) {
    slotsPerDay.set(slot.date, (slotsPerDay.get(slot.date) ?? 0) + 1);
  }
  const capacity = Math.max(tenant?.publish_hours?.length ?? 0, 1);
  const defaultDate = nextFreeDate(slotsPerDay, capacity, limaToday());

  // full-auto ya elige la mejor sugerencia pendiente por su cuenta todos los
  // días (ver news-slot.ts) — pedirle a alguien que además la apruebe acá
  // sería una aprobación de mentira, nunca se llega a tiempo antes de que el
  // agente ya haya elegido. approve-all/approve-creatives sí necesitan que
  // una persona elija, así que mantienen los botones de siempre.
  const isFullAuto = tenant?.hitl_mode === "full-auto";
  const pending = suggestions ?? [];
  const decided = recentDecided ?? [];
  const now = new Date();

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow={ctx.tenantName}
        title="Noticias"
        description={
          isFullAuto
            ? `${pendingLabel(pending.length)} El agente revisa los titulares cada día y elige solo la que mejor le sirve a tu negocio para armar el post — no hace falta aprobar nada acá. Abajo queda el historial de cuáles se usaron.`
            : `${pendingLabel(pending.length)} El agente revisa los titulares cada día y te deja acá los que le sirven a tu negocio, con una idea concreta para cada uno. Nada se publica solo: tú eliges cuáles usar y para qué día.`
        }
      />

      {pending.length === 0 ? (
        <EmptyState
          icon={<Newspaper size={28} aria-hidden="true" />}
          title="Sin ideas pendientes"
          description="El agente de noticias corre todos los días a las 7:00. Vuelve más tarde o pídele a alguien del equipo que lo dispare manualmente si necesitas verlo antes."
        />
      ) : (
        <div className="space-y-4">
          {pending.map((s) => (
            <Card key={s.id} padding="sm">
              <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-fg-3">
                <span className="eyebrow text-fg-3">{s.source_name ?? "Fuente"}</span>
                <span title={s.created_at}>{formatRelative(s.created_at, now)}</span>
              </div>
              <h2 className="mt-1 font-display text-lg font-semibold text-fg">
                <a
                  href={s.source_url}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-start gap-1.5 hover:text-accent-ink"
                >
                  <span>{s.headline}</span>
                  <ExternalLink size={14} className="mt-1.5 shrink-0 text-fg-3" aria-hidden="true" />
                </a>
              </h2>
              {s.summary && <p className="mt-1 text-sm text-fg-3">{s.summary}</p>}

              <div className="mt-3 rounded-btn border border-line bg-ink p-3 text-sm text-fg-2">
                <span className="eyebrow text-accent-ink">Ángulo sugerido</span>
                <p className="mt-1">{s.angle}</p>
              </div>

              {isFullAuto ? (
                <p className="mt-4 text-xs text-fg-3">
                  En espera de que el agente la evalúe junto con el resto de hoy — full-auto elige sola, no
                  necesita que la apruebes.
                </p>
              ) : (
                <div className="mt-4 flex flex-wrap items-end gap-3">
                  <UseIdeaForm tenantId={ctx.tenantId} suggestionId={s.id} defaultDate={defaultDate} />

                  <form action={dismissNewsSuggestionAction}>
                    <input type="hidden" name="tenantId" value={ctx.tenantId} />
                    <input type="hidden" name="suggestionId" value={s.id} />
                    <SubmitButton variant="dangerGhost" size="sm" pendingText="Descartando…">
                      Descartar
                    </SubmitButton>
                  </form>
                </div>
              )}
            </Card>
          ))}
        </div>
      )}

      {decided.length > 0 && (
        <div className="space-y-3">
          <p className="eyebrow text-fg-3">Historial reciente</p>
          <div className="space-y-2">
            {decided.map((s) => (
              <Card key={s.id} padding="sm" className="flex flex-wrap items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate text-sm text-fg">{s.headline}</p>
                  <p className="text-xs text-fg-3">{s.source_name ?? "Fuente"} · {formatRelative(s.created_at, now)}</p>
                </div>
                <StatusBadge tone={s.status === "used" ? "green" : "grey"}>
                  {s.status === "used" ? "Usada" : "Descartada"}
                </StatusBadge>
              </Card>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
