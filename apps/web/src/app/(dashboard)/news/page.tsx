import { getTenantContext } from "@/lib/tenant-context";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { dismissNewsSuggestionAction, useNewsSuggestionAction } from "@/lib/actions";
import { inputClass, labelClass } from "@/components/ui/field";
import { Card } from "@/components/ui/card";
import { SubmitButton } from "@/components/submit-button";

function tomorrow(): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

export default async function NewsPage() {
  const ctx = await getTenantContext();
  const supabase = await createSupabaseServerClient();

  const { data: suggestions } = await supabase
    .from("news_suggestions")
    .select("*")
    .eq("tenant_id", ctx.tenantId)
    .eq("status", "pending")
    .order("created_at", { ascending: false });

  const defaultDate = tomorrow();

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
              <form action={useNewsSuggestionAction} className="flex flex-wrap items-end gap-3">
                <input type="hidden" name="tenantId" value={ctx.tenantId} />
                <input type="hidden" name="suggestionId" value={s.id} />
                <div>
                  <label className={labelClass}>Fecha para el post</label>
                  <input type="date" name="date" defaultValue={defaultDate} className={inputClass} />
                </div>
                <SubmitButton
                  pendingText="Creando…"
                  className="rounded-lg bg-pulso-primary px-4 py-2 text-sm font-medium text-white transition-colors duration-300 ease-in-out hover:bg-pulso-accent disabled:cursor-not-allowed disabled:opacity-60"
                >
                  Usar esta idea
                </SubmitButton>
              </form>

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
