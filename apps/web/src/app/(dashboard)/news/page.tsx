import { getTenantContext } from "@/lib/tenant-context";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { dismissNewsSuggestionAction } from "@/lib/actions";
import { Card } from "@/components/ui/card";
import { UseIdeaForm } from "./use-idea-form";

/**
 * Starting tomorrow, the first date with no content_calendar row yet —
 * content_calendar has one slot per day, so proposing an already-taken date
 * as the default would just make the common case hit the "day already
 * planned" error the form now has to handle anyway.
 */
function nextFreeDate(takenDates: ReadonlySet<string>): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + 1);
  for (let i = 0; i < 90; i++) {
    const iso = d.toISOString().slice(0, 10);
    if (!takenDates.has(iso)) return iso;
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return d.toISOString().slice(0, 10);
}

export default async function NewsPage() {
  const ctx = await getTenantContext();
  const supabase = await createSupabaseServerClient();

  const [{ data: suggestions }, { data: plannedSlots }] = await Promise.all([
    supabase
      .from("news_suggestions")
      .select("*")
      .eq("tenant_id", ctx.tenantId)
      .eq("status", "pending")
      .order("created_at", { ascending: false }),
    supabase.from("content_calendar").select("date").eq("tenant_id", ctx.tenantId),
  ]);

  const defaultDate = nextFreeDate(new Set((plannedSlots ?? []).map((s) => s.date)));

  return (
    <div className="space-y-6">
      <div>
        <p className="mb-1 font-display text-xs uppercase tracking-[0.2em] text-pulso-accent">Noticias</p>
        <h1 className="font-display text-2xl font-semibold">Ideas del día para {ctx.tenantName}</h1>
        <p className="mt-1 text-sm text-neutral-500">
          Cada día el agente de noticias revisa los titulares y te deja acá los que le sirven a tu negocio,
          con una idea de contenido concreta para cada uno. Nada se publica solo — tú eliges cuáles usar y
          para qué día.
        </p>
      </div>

      {(!suggestions || suggestions.length === 0) && (
        <Card className="p-5 text-sm text-neutral-500">
          Todavía no hay noticias sugeridas. El agente corre una vez al día — vuelve mañana, o pídele a
          alguien del equipo que lo dispare manualmente si necesitas verlo antes.
        </Card>
      )}

      <div className="space-y-4">
        {suggestions?.map((s) => (
          <Card key={s.id} className="p-5">
            <p className="text-xs uppercase tracking-[0.15em] text-neutral-600">{s.source_name ?? "Fuente"}</p>
            <h2 className="mt-1 font-display text-lg font-semibold text-neutral-100">
              <a href={s.source_url} target="_blank" rel="noreferrer" className="hover:text-pulso-accent">
                {s.headline}
              </a>
            </h2>
            {s.summary && <p className="mt-1 text-sm text-neutral-500">{s.summary}</p>}

            <div className="mt-3 rounded-lg border border-ink-700 bg-ink-950 p-3 text-sm text-neutral-300">
              <span className="text-xs uppercase tracking-[0.15em] text-pulso-accent">Ángulo sugerido</span>
              <p className="mt-1">{s.angle}</p>
            </div>

            <div className="mt-4 flex flex-wrap items-end gap-3">
              <UseIdeaForm tenantId={ctx.tenantId} suggestionId={s.id} defaultDate={defaultDate} />

              <form action={dismissNewsSuggestionAction}>
                <input type="hidden" name="tenantId" value={ctx.tenantId} />
                <input type="hidden" name="suggestionId" value={s.id} />
                <button
                  type="submit"
                  className="rounded-lg border border-ink-700 px-4 py-2 text-sm text-neutral-400 hover:border-status-pink/60 hover:text-status-pink"
                >
                  Descartar
                </button>
              </form>
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}
