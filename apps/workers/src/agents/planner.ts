import { z } from "zod";
import { createServiceRoleClient, getActivePrompt } from "@pulso/db/worker";
import type { Database } from "@pulso/db/types";
import { publishEvent } from "@pulso/events/publish";
import { newCorrelationId } from "@pulso/shared/ids";
import { createLogger } from "@pulso/shared/logger";
import { callAgentLlm } from "../agent-llm.js";
import { executeAgentRun } from "@pulso/publish/base-agent";
import { computeOpenDates, formatDate, resolveEphemeridesInWindow } from "./planner-helpers.js";

const logger = createLogger({ agent: "planner-tick" });

const HORIZON_DAYS = 30;

type PromotionRow = Database["public"]["Tables"]["promotions"]["Row"];
type ProductRow = Database["public"]["Tables"]["products_services"]["Row"];

const plannerResponseSchema = z.object({
  slots: z.array(
    z.object({
      date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      slot_type: z.enum(["post", "carousel", "story", "reel"]),
      theme: z.string().min(1),
      rationale: z.string().min(1),
    }),
  ),
});

function renderPrompt(template: string, vars: Record<string, string>): string {
  let rendered = template;
  for (const [key, value] of Object.entries(vars)) {
    rendered = rendered.replaceAll(`{{${key}}}`, value);
  }
  return rendered;
}

function formatEphemerides(list: { date: string; name: string }[]): string {
  if (list.length === 0) return "(ninguna en este rango)";
  return list.map((e) => `- ${e.date}: ${e.name}`).join("\n");
}

function formatPromotions(list: PromotionRow[]): string {
  if (list.length === 0) return "(ninguna activa)";
  return list
    .map((p) => {
      const discount =
        p.discount_type === "percentage" ? `${p.discount_value}%` : `S/ ${p.discount_value}`;
      return `- ${p.name} (${discount}) vigente hasta ${p.ends_at.slice(0, 10)}`;
    })
    .join("\n");
}

function formatProducts(list: ProductRow[]): string {
  if (list.length === 0) return "(sin catálogo cargado)";
  return list.map((p) => `- ${p.name}${p.price ? ` (S/ ${p.price})` : ""}`).join("\n");
}

/**
 * Detects gaps in the next 30 days, resolves relevant ephemerides/promos/
 * catalog for this tenant, and asks the local LLM to propose a theme for
 * each open date. Never trusts the model blindly: proposed dates outside
 * the actual open-dates window are dropped, and `upsertContentCalendarSlot`
 * is a no-op if a slot already exists (unique tenant_id+date), so running
 * this twice the same day never duplicates or overwrites a slot.
 */
export async function runPlannerForTenant(
  tenantId: string,
  trigger: string,
  correlationId: string,
  jobId?: string,
): Promise<void> {
  await executeAgentRun({ agent: "planner", tenantId, trigger, correlationId }, async (ctx) => {
    const tenant = await ctx.db.getTenant();
    const today = new Date();
    const horizonEnd = new Date(today);
    horizonEnd.setUTCDate(horizonEnd.getUTCDate() + HORIZON_DAYS - 1);

    const existingSlots = await ctx.db.listContentCalendar(
      formatDate(today),
      formatDate(horizonEnd),
    );
    const filledDates = new Set(existingSlots.map((slot) => slot.date));
    const openDates = computeOpenDates(today, HORIZON_DAYS, filledDates);

    if (openDates.length === 0) {
      await ctx.db.insertDecisionLog({
        agent: "planner",
        observed: { open_dates: 0 },
        decision: { action: "skip" },
        rationale: "El calendario ya está cubierto para los próximos 30 días.",
        correlation_id: correlationId,
      });
      return;
    }

    const service = createServiceRoleClient();
    const [ephemerides, promotions, products, promptTemplate] = await Promise.all([
      ctx.db.listEphemerides(),
      ctx.db.listActivePromotions(),
      ctx.db.listActiveProducts(),
      getActivePrompt(service, "planner.calendar"),
    ]);

    const resolvedEphemerides = resolveEphemeridesInWindow(
      ephemerides,
      today,
      HORIZON_DAYS,
      tenant.rubro,
    );

    const prompt = renderPrompt(promptTemplate, {
      RUBRO: tenant.rubro ?? "general",
      OPEN_DATES: openDates.join(", "),
      EPHEMERIDES: formatEphemerides(resolvedEphemerides),
      PROMOTIONS: formatPromotions(promotions),
      PRODUCTS: formatProducts(products),
    });

    const proposal = await callAgentLlm({
      agentName: "planner",
      tenantId,
      ...(jobId ? { jobId } : {}),
      correlationId,
      prompt,
      schema: plannerResponseSchema,
    });
    const openDatesSet = new Set(openDates);
    let proposedCount = 0;

    // approve-creatives and full-auto both skip manual slot approval — the
    // difference between them is whether the *creative* also auto-approves
    // (handled in creative.ts), not whether the slot does.
    const autoApproveSlot = tenant.hitl_mode !== "approve-all";

    for (const slot of proposal.slots) {
      if (!openDatesSet.has(slot.date)) {
        ctx.logger.warn(
          { date: slot.date },
          "planner proposed a date outside the open-dates window, skipping",
        );
        continue;
      }

      const inserted = await ctx.db.upsertContentCalendarSlot({
        date: slot.date,
        slot_type: slot.slot_type,
        theme: slot.theme,
        source: { agent: "planner", rationale: slot.rationale },
        ...(autoApproveSlot ? { status: "approved" as const } : {}),
      });

      if (inserted && autoApproveSlot) {
        await publishEvent(service, {
          tenantId,
          type: "creative.requested",
          payload: { calendarSlotId: inserted.id },
          correlationId,
        });
      }

      await ctx.db.insertDecisionLog({
        agent: "planner",
        observed: { date: slot.date, rubro: tenant.rubro },
        decision: { slot_type: slot.slot_type, theme: slot.theme },
        rationale: slot.rationale,
        correlation_id: correlationId,
      });

      proposedCount++;
    }

    await publishEvent(service, {
      tenantId,
      type: "calendar.slots.proposed",
      payload: { count: proposedCount },
      correlationId,
    });
  });
}

/**
 * Daily fan-out (mirrors orchestrator.ts): emits `calendar.plan.requested`
 * for every active tenant so each run traces back to an outbox event, the
 * same as a manual "Regenerar" click does via `request_calendar_regeneration`.
 */
export async function runPlannerTick(): Promise<void> {
  const service = createServiceRoleClient();
  const { data: tenants, error } = await service
    .from("tenants")
    .select("id")
    .eq("status", "active");

  if (error) {
    logger.error({ err: error }, "failed to list active tenants for planner tick");
    return;
  }

  for (const tenant of tenants ?? []) {
    await publishEvent(service, {
      tenantId: tenant.id,
      type: "calendar.plan.requested",
      payload: {},
      correlationId: newCorrelationId(),
    });
  }

  logger.info({ tenantCount: tenants?.length ?? 0 }, "planner tick complete");
}
