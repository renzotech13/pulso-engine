import Link from "next/link";
import { CalendarDays } from "lucide-react";
import { getTenantContext } from "@/lib/tenant-context";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getTenantStats, parseStatsDays, STATS_DAY_OPTIONS, type StatsSnapshot } from "@/lib/stats";
import { formatRelative, label, ORIGIN, PHOTO_SOURCE, SLOT_TYPE } from "@/lib/labels";
import { HorizontalBarChart, LineSeriesChart, StackedBarChart } from "@/components/charts";
import { buttonClass } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { Segmented } from "@/components/ui/segmented";
import { StatTile } from "@/components/ui/stat-tile";
import { StatusBadge } from "@/components/ui/status-badge";

interface StatsPageProps {
  searchParams: Promise<{ dias?: string }>;
}

function hourLabel(hour: number): string {
  return `${String(hour).padStart(2, "0")}:00`;
}

/** "10:00", "10:00 y 16:00", "9:00, 13:00 y 18:00". */
function publishHoursText(hours: number[]): string {
  const labels = hours.map(hourLabel);
  if (labels.length <= 1) return labels[0] ?? "10:00";
  return `${labels.slice(0, -1).join(", ")} y ${labels[labels.length - 1]}`;
}

function Funnel({ steps }: { steps: { label: string; value: number }[] }) {
  const max = Math.max(1, ...steps.map((s) => s.value));
  return (
    <ol className="space-y-3">
      {steps.map((step, i) => (
        <li key={step.label}>
          <div className="mb-1 flex items-baseline justify-between text-xs">
            <span className="text-neutral-400">{step.label}</span>
            <span className="font-display text-base text-neutral-100">{step.value}</span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-ink-800">
            <div
              className="h-full rounded-full bg-pulso-primary transition-[width]"
              style={{ width: `${Math.round((step.value / max) * 100)}%`, opacity: 1 - i * 0.18 }}
            />
          </div>
        </li>
      ))}
    </ol>
  );
}

function MotorTile({ motor }: { motor: StatsSnapshot["motor"] }) {
  const reference = motor.lastSuccessAt ?? motor.lastRunAt;
  return (
    <div className="rounded-lg border border-ink-700 bg-ink-950 p-4">
      <p className="text-[11px] uppercase tracking-wide text-neutral-500">Motor</p>
      <div className="mt-2">
        {motor.healthy ? (
          <StatusBadge tone="green">Activo</StatusBadge>
        ) : (
          <StatusBadge tone="orange">Sin actividad</StatusBadge>
        )}
      </div>
      <p className="mt-2 text-sm text-neutral-300">
        {motor.healthy && reference
          ? `Última corrida ${formatRelative(reference)}`
          : reference
            ? `Sin actividad desde ${formatRelative(reference)} — avísale al operador`
            : "Todavía no corrió — avísale al operador"}
      </p>
    </div>
  );
}

function ConnectionTile({ connection, isViewer }: { connection: StatsSnapshot["connection"]; isViewer: boolean }) {
  return (
    <div className="rounded-lg border border-ink-700 bg-ink-950 p-4">
      <p className="text-[11px] uppercase tracking-wide text-neutral-500">Conexión Meta</p>
      {isViewer || !connection ? (
        <p className="mt-2 text-sm text-neutral-500">
          {isViewer ? (
            "Solo visible para administradores"
          ) : (
            <>
              Sin conectar ·{" "}
              <Link href="/connections" className="text-pulso-accent hover:underline">
                Conectar página
              </Link>
            </>
          )}
        </p>
      ) : (
        <>
          <div className="mt-2">
            {connection.status === "active" ? (
              <StatusBadge tone="green">Activa</StatusBadge>
            ) : (
              <StatusBadge tone="pink">Inválida</StatusBadge>
            )}
          </div>
          <p className="mt-2 text-sm text-neutral-300">
            {connection.pageName ?? "Página sin nombre"} · Instagram: {connection.instagramUsername ? "sí" : "no"}
          </p>
          <p className="mt-1 text-xs text-neutral-500">
            {connection.lastVerifiedAt ? `Verificada ${formatRelative(connection.lastVerifiedAt)}` : "Sin verificar todavía"}
          </p>
          {connection.status !== "active" && connection.lastError && (
            <p className="mt-1 text-xs text-status-pink">{connection.lastError}</p>
          )}
        </>
      )}
    </div>
  );
}

export default async function StatsPage({ searchParams }: StatsPageProps) {
  const sp = await searchParams;
  const days = parseStatsDays(sp.dias);

  const ctx = await getTenantContext();
  const supabase = await createSupabaseServerClient();
  const stats = await getTenantStats(supabase, ctx, days);

  const isViewer = ctx.role === "viewer";
  const hoursText = publishHoursText(stats.tenant.publishHours);
  const hasTarde = stats.tenant.publishHours.length > 1;
  const attentionCount = stats.attention.length;

  const rangeToggle = (
    <Segmented
      ariaLabel="Periodo"
      items={STATS_DAY_OPTIONS.map((d) => ({ href: `/stats?dias=${d}`, label: `${d} días`, active: d === days }))}
    />
  );

  const header = (
    <PageHeader
      eyebrow={ctx.tenantName}
      title="Estadísticas"
      description="Qué salió, qué está por salir y qué necesita tu atención · hora de Lima"
      actions={rangeToggle}
    />
  );

  const stateCard = (
    <Card>
      <CardHeader title="Estado" description="El motor que arma y publica, y la página conectada" />
      <div className="grid gap-3 sm:grid-cols-2">
        <MotorTile motor={stats.motor} />
        <ConnectionTile connection={stats.connection} isViewer={isViewer} />
      </div>
    </Card>
  );

  if (!stats.hasPublished) {
    return (
      <div className="space-y-6">
        {header}
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatTile label="Publicadas" value="—" />
          <StatTile label="Próximos 7 días" value="—" />
          <StatTile label="Requieren atención" value="—" />
          <StatTile label="Cobertura" value="—" />
        </div>
        <EmptyState
          icon={<CalendarDays size={32} />}
          title="Todavía no hay publicaciones."
          description={`El calendario se arma a las 10:00 y las piezas salen a las ${hoursText}.`}
          action={
            <Link href="/calendar" className={buttonClass("primary", "md")}>
              Ver el calendario
            </Link>
          }
        />
        {stateCard}
      </div>
    );
  }

  // Mirrors stats.ts's dayPartKeys ("daypart0", "daypart1", …) — one series
  // per configured publish hour, not a hardcoded Mañana/Tarde pair, so a
  // third or fourth daily slot gets its own bar instead of silently merging
  // into "Tarde".
  const DAYPART_NAMES = ["Mañana", "Tarde", "Turno 3", "Turno 4"];
  const publishedSeries = hasTarde
    ? stats.tenant.publishHours.map((hour, i) => ({
        key: `daypart${i}`,
        name: `${DAYPART_NAMES[i] ?? `Turno ${i + 1}`} (${hourLabel(hour)})`,
      }))
    : [{ key: "daypart0", name: "Publicadas" }];

  const formatData = stats.formatMix.map((m) => ({ label: label(SLOT_TYPE, m.key), value: m.count }));
  const originData = stats.originMix.map((m) => ({ label: label(ORIGIN, m.key), value: m.count }));
  const photoSummary = stats.photoSourceMix.map((m) => `${label(PHOTO_SOURCE, m.key)}: ${m.count}`).join(" · ");
  const hasNewsInPeriod = stats.news.used + stats.news.dismissed + stats.news.topSources.length > 0 || stats.news.pending > 0;

  return (
    <div className="space-y-6">
      {header}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile label="Publicadas" value={stats.totals.published} hint={`de ${stats.totals.planned} planificadas`} />
        <StatTile
          label="Próximos 7 días"
          value={stats.totals.upcoming7}
          hint={
            stats.tenant.hitlMode === "full-auto" ? `Salen solas a las ${hoursText}` : "Aprobadas y listas para salir"
          }
        />
        <StatTile
          label="Requieren atención"
          value={attentionCount}
          tone={attentionCount > 0 ? "pink" : "neutral"}
          hint={attentionCount > 0 ? "Sin publicar, falladas o por revisar" : "Todo en orden"}
          href="/calendar?view=list&filtro=atencion"
        />
        <StatTile
          label="Cobertura"
          value={`${stats.coverage.pct}%`}
          tone={stats.coverage.pct < 80 ? "orange" : "neutral"}
          hint={
            stats.coverage.tardeFill
              ? `Tarde: ${stats.coverage.tardeFill.filled}/${stats.coverage.tardeFill.total} días`
              : `${stats.coverage.filledDays}/${stats.coverage.totalDays} días con pieza`
          }
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title="Publicaciones por semana" description={`Salen a las ${hoursText}`} />
          <StackedBarChart data={stats.publishedByWeek} series={publishedSeries} />
        </Card>
        <Card>
          <CardHeader title="Por plataforma" description="Las programadas en Facebook cuentan como publicadas" />
          <LineSeriesChart
            data={stats.byPlatformByWeek}
            series={[
              { key: "facebook", name: "Facebook" },
              { key: "instagram", name: "Instagram" },
            ]}
          />
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader
            title="Formatos"
            description={
              stats.tenant.maxWeeklyCarousels !== null ? `Máx. ${stats.tenant.maxWeeklyCarousels} carruseles/semana` : undefined
            }
          />
          {formatData.length > 0 ? (
            <HorizontalBarChart data={formatData} valueName="Piezas" />
          ) : (
            <p className="text-sm text-neutral-500">Sin piezas planificadas en el periodo.</p>
          )}
        </Card>
        <Card>
          <CardHeader title="Origen del contenido" description="Quién propuso cada pieza" />
          {originData.length > 0 ? (
            <HorizontalBarChart data={originData} valueName="Piezas" />
          ) : (
            <p className="text-sm text-neutral-500">Sin piezas planificadas en el periodo.</p>
          )}
          {photoSummary && <p className="mt-3 text-xs text-neutral-500">Fotos · {photoSummary}</p>}
        </Card>
        <Card>
          <CardHeader title="Embudo del periodo" description="De la idea a la publicación" />
          <Funnel
            steps={[
              { label: "Planificados", value: stats.funnel.planned },
              { label: "Con pieza", value: stats.funnel.withPiece },
              { label: "Aprobados", value: stats.funnel.approved },
              { label: "Publicados", value: stats.funnel.published },
            ]}
          />
        </Card>
      </div>

      <Card>
        <CardHeader
          title="Noticias"
          description="Ideas que el agente de noticias encontró y qué pasó con ellas"
          actions={
            <Link href="/news" className={buttonClass("link")}>
              Ver ideas pendientes ({stats.news.pending})
            </Link>
          }
        />
        {hasNewsInPeriod ? (
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_240px]">
            <StackedBarChart
              data={stats.news.byWeek}
              series={[
                { key: "usadas", name: "Usadas" },
                { key: "descartadas", name: "Descartadas" },
                { key: "pendientes", name: "Pendientes" },
              ]}
            />
            <div>
              <p className="mb-2 text-[11px] uppercase tracking-wide text-neutral-500">Fuentes más frecuentes</p>
              {stats.news.topSources.length > 0 ? (
                <ol className="space-y-1.5">
                  {stats.news.topSources.map((s) => (
                    <li key={s.name} className="flex items-center justify-between gap-3 text-sm">
                      <span className="truncate text-neutral-300">{s.name}</span>
                      <span className="shrink-0 font-display text-neutral-100">{s.count}</span>
                    </li>
                  ))}
                </ol>
              ) : (
                <p className="text-sm text-neutral-500">Sin fuentes en el periodo.</p>
              )}
            </div>
          </div>
        ) : (
          <p className="text-sm text-neutral-500">Sin noticias en el periodo.</p>
        )}
      </Card>

      {stateCard}

      {stats.topPublishErrors.length > 0 && (
        <Card>
          <CardHeader title="Errores de publicación" description="Los mensajes más repetidos del periodo" />
          <ul className="divide-y divide-ink-700">
            {stats.topPublishErrors.map((e) => (
              <li key={e.message} className="flex items-start justify-between gap-4 py-2 text-sm">
                <span className="break-words text-neutral-300">{e.message}</span>
                <StatusBadge tone="pink" className="shrink-0">
                  {e.count} {e.count === 1 ? "vez" : "veces"}
                </StatusBadge>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
