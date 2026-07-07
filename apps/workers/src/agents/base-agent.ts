import { createTenantScopedClient, type TenantScopedClient } from "@pulso/db/worker";
import { createLogger, type Logger } from "@pulso/shared/logger";
import { AgentExecutionError } from "@pulso/shared/errors";

export interface AgentContext {
  tenantId: string;
  correlationId: string;
  db: TenantScopedClient;
  logger: Logger;
}

export interface AgentRunParams {
  agent: string;
  tenantId: string;
  trigger: string;
  correlationId: string;
}

/**
 * Wraps one agent execution and writes exactly one row to `agent_runs` when
 * it concludes (success or failure) — never an UPDATE. That keeps the table
 * genuinely append-only (grants revoke UPDATE/DELETE outright, see migration
 * 00000000000001) at the cost of not showing "in progress" runs live; for
 * Fase 0's short-lived agents that trade-off is fine.
 */
export async function executeAgentRun<T extends Record<string, unknown> | void>(
  params: AgentRunParams,
  handler: (ctx: AgentContext) => Promise<T>,
): Promise<T> {
  const startedAt = new Date();
  const db = createTenantScopedClient(params.tenantId);
  const logger = createLogger({
    agent: params.agent,
    tenantId: params.tenantId,
    correlationId: params.correlationId,
  });
  const ctx: AgentContext = { tenantId: params.tenantId, correlationId: params.correlationId, db, logger };

  try {
    const result = await handler(ctx);
    await db.insertAgentRun({
      agent: params.agent,
      trigger: params.trigger,
      status: "succeeded",
      started_at: startedAt.toISOString(),
      finished_at: new Date().toISOString(),
      result: (result as Record<string, unknown> | undefined) ?? null,
      correlation_id: params.correlationId,
    });
    logger.info({ durationMs: Date.now() - startedAt.getTime() }, "agent run succeeded");
    return result;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await db.insertAgentRun({
      agent: params.agent,
      trigger: params.trigger,
      status: "failed",
      started_at: startedAt.toISOString(),
      finished_at: new Date().toISOString(),
      error: message,
      correlation_id: params.correlationId,
    });
    logger.error({ err }, "agent run failed");
    throw new AgentExecutionError(`agent ${params.agent} failed: ${message}`, err);
  }
}
