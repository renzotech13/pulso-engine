import { createServiceRoleClient } from "@pulso/db/worker";
import { publishEvent } from "@pulso/events/publish";
import type { EventPayload } from "@pulso/events/catalog";
import { executeAgentRun } from "@pulso/publish/base-agent";

/**
 * Fase 0 proof-of-loop agent: acknowledges a heartbeat, records why it
 * decided to (the `decision_log` entry), and closes the loop by emitting
 * the completion event. Deleted once Fase 1's real agents exist.
 */
export async function runHelloAgent(
  tenantId: string,
  correlationId: string,
  payload: EventPayload<"agent.heartbeat.requested">,
): Promise<void> {
  await executeAgentRun(
    { agent: "hello", tenantId, trigger: "agent.heartbeat.requested", correlationId },
    async (ctx) => {
      ctx.logger.info({ reason: payload.reason }, "hello agent heartbeat");

      await ctx.db.insertDecisionLog({
        agent: "hello",
        observed: { reason: payload.reason },
        decision: { action: "acknowledge" },
        rationale: "Fase 0 demo loop: acknowledge heartbeat request",
        correlation_id: correlationId,
      });

      await publishEvent(createServiceRoleClient(), {
        tenantId,
        type: "agent.heartbeat.completed",
        payload: { status: "ok" },
        correlationId,
      });
    },
  );
}
