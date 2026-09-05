import { createServiceRoleClient } from "@pulso/db/worker";
import { publishEvent } from "@pulso/events/publish";
import { limaDatePlusDays, limaHour, limaToday } from "@pulso/shared/time";
import { executeAgentRun } from "@pulso/publish/base-agent";

/**
 * Fills the day's news slot (index 1) with the best pending suggestion.
 *
 * This exists because under `full-auto` nobody is going to open /news and
 * turn a suggestion into content: suggestions just piled up as 'pending'
 * forever, and the news agent — which already ran daily — never produced a
 * single publication. This closes that loop.
 *
 * It hangs off `news.suggestions.generated` rather than being its own tick so
 * the ordering with the digest is deterministic: the day's suggestions are
 * generated first, then one gets picked. Two 24h ticks firing at roughly the
 * same moment gave no such guarantee.
 *
 * It coexists with the Planner without stepping on it: the Planner owns slot
 * 0 (see planner.ts) and this only ever touches slot 1.
 */
export async function fillNewsSlotForTenant(
  tenantId: string,
  correlationId: string,
): Promise<void> {
  await executeAgentRun(
    { agent: "news", tenantId, trigger: "news.suggestions.generated", correlationId },
    async (ctx) => {
      const tenant = await ctx.db.getTenant();
      const newsHour = tenant.publish_hours?.[1];
      // With no second hour scheduled the tenant publishes once a day and
      // this slot simply doesn't exist for them — the case for every tenant
      // that predates this function.
      if (newsHour === undefined) return;

      // The digest runs mid-morning (see main.ts). A tenant whose second
      // publish hour is earlier than that would get today's slot created
      // after it was already due, and publish-tick's straggler catch-up
      // would then post it hours late. Fill tomorrow's slot instead so it
      // still goes out at its configured hour.
      const today = limaToday();
      const date = newsHour > limaHour() ? today : limaDatePlusDays(today, 1);
      const service = createServiceRoleClient();

      const existing = await ctx.db.listContentCalendar(date, date);
      if (existing.some((slot) => slot.slot_index === 1)) return;

      // MOST RELEVANT first, freshness only as the tiebreak. Ordering by
      // recency alone meant a tangential story published an hour ago beat
      // one squarely about the tenant's trade published yesterday. Older
      // suggestions stay candidates, so a day with no new headlines pulls
      // from the backlog instead of leaving the slot empty.
      const { data: suggestion } = await service
        .from("news_suggestions")
        .select("id, headline, angle, relevance")
        .eq("tenant_id", tenantId)
        .eq("status", "pending")
        .order("relevance", { ascending: false, nullsFirst: false })
        .order("published_at", { ascending: false, nullsFirst: false })
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (!suggestion) {
        await ctx.db.insertDecisionLog({
          agent: "news",
          observed: { date, pending_suggestions: 0 },
          decision: { action: "skip" },
          rationale:
            "No hay ninguna sugerencia de noticias pendiente, así que hoy el slot de actualidad queda vacío.",
          correlation_id: correlationId,
        });
        return;
      }

      const autoApproveSlot = tenant.hitl_mode !== "approve-all";

      const inserted = await ctx.db.upsertContentCalendarSlot({
        date,
        slot_index: 1,
        publish_hour: newsHour,
        slot_type: "post",
        theme: suggestion.angle,
        source: { agent: "news", rationale: suggestion.headline, suggestion_id: suggestion.id },
        ...(autoApproveSlot ? { status: "approved" as const } : {}),
      });

      // Another run won the race for this slot (the upsert ignores the
      // conflict and returns null): the suggestion stays 'pending' and will
      // be used tomorrow, so there's nothing to undo.
      if (!inserted) return;

      await service
        .from("news_suggestions")
        .update({ status: "used" })
        .eq("id", suggestion.id)
        .eq("tenant_id", tenantId);

      if (autoApproveSlot) {
        await publishEvent(service, {
          tenantId,
          type: "creative.requested",
          payload: { calendarSlotId: inserted.id },
          correlationId,
        });
      }

      await ctx.db.insertDecisionLog({
        agent: "news",
        observed: { date, headline: suggestion.headline, relevance: suggestion.relevance },
        decision: { slot_index: 1, publish_hour: newsHour, theme: suggestion.angle },
        rationale: `Se llenó el slot de actualidad del ${date} con la sugerencia pendiente más relevante para el rubro${
          suggestion.relevance ? ` (relevancia ${suggestion.relevance}/5)` : ""
        }.`,
        correlation_id: correlationId,
      });
    },
  );
}
