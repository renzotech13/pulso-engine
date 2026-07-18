import type { z } from "zod";
import { createTenantScopedClient } from "@pulso/db/worker";
import { callLlmStructuredWithUsage, LlmOutputError, type CallLlmStructuredOptions } from "@pulso/shared/llm";
import { AppError } from "@pulso/shared/errors";
import { createLogger } from "@pulso/shared/logger";

const logger = createLogger({ agent: "agent-llm" });

export class AgentNotAuthorizedError extends AppError {
  constructor(message: string) {
    super(message, "AGENT_NOT_AUTHORIZED");
    this.name = "AgentNotAuthorizedError";
  }
}

export class TokenLimitExceededError extends AppError {
  constructor(message: string) {
    super(message, "TOKEN_LIMIT_EXCEEDED");
    this.name = "TokenLimitExceededError";
  }
}

export interface CallAgentLlmParams<S extends z.ZodTypeAny> {
  agentName: string;
  tenantId: string;
  jobId?: string;
  correlationId: string;
  prompt: string;
  schema: S;
  options?: CallLlmStructuredOptions;
}

/**
 * The only entry point agent code should use to call the LLM — no agent
 * should import @pulso/shared/llm directly. Before calling: checks
 * agents_registry (tenant-specific override, else the global registration)
 * is active, and that the tenant hasn't exceeded its token budget. Neither
 * check costs a model call. After calling: records the real token usage
 * from the response (free — already included, no extra API call) into
 * agent_calls, whether the call succeeded, failed validation, or errored.
 */
export async function callAgentLlm<S extends z.ZodTypeAny>(
  params: CallAgentLlmParams<S>,
): Promise<z.infer<S>> {
  const { agentName, tenantId, jobId, correlationId, prompt, schema, options } = params;
  const db = createTenantScopedClient(tenantId);
  const startedAt = Date.now();

  const registration = await db.getAgentRegistration(agentName);

  if (!registration || registration.status !== "active") {
    const reason = !registration ? "not registered" : "disabled";
    await db.insertAgentCall({
      agent_id: registration?.id ?? null,
      agent_name: agentName,
      job_id: jobId ?? null,
      correlation_id: correlationId,
      status: "blocked",
      error_message: `agent is ${reason}`,
      latency_ms: Date.now() - startedAt,
    });
    logger.warn({ agentName, tenantId, reason }, "agent LLM call blocked: not authorized");
    throw new AgentNotAuthorizedError(`agent "${agentName}" is ${reason} for tenant ${tenantId}`);
  }

  const tenant = await db.getTenant();

  if (tenant.token_limit_daily !== null) {
    const usedToday = await db.sumTokensToday();
    if (usedToday >= tenant.token_limit_daily) {
      await db.insertAgentCall({
        agent_id: registration.id,
        agent_name: agentName,
        job_id: jobId ?? null,
        correlation_id: correlationId,
        status: "blocked",
        error_message: `daily token limit exceeded (${usedToday}/${tenant.token_limit_daily})`,
        latency_ms: Date.now() - startedAt,
      });
      logger.warn(
        { agentName, tenantId, usedToday, limit: tenant.token_limit_daily },
        "agent LLM call blocked: daily token limit exceeded",
      );
      throw new TokenLimitExceededError(`tenant ${tenantId} exceeded its daily token limit`);
    }
  }

  if (jobId && tenant.token_limit_per_job !== null) {
    const usedThisJob = await db.sumTokensForJob(jobId);
    if (usedThisJob >= tenant.token_limit_per_job) {
      await db.insertAgentCall({
        agent_id: registration.id,
        agent_name: agentName,
        job_id: jobId,
        correlation_id: correlationId,
        status: "blocked",
        error_message: `per-job token limit exceeded (${usedThisJob}/${tenant.token_limit_per_job})`,
        latency_ms: Date.now() - startedAt,
      });
      logger.warn(
        { agentName, tenantId, jobId, usedThisJob, limit: tenant.token_limit_per_job },
        "agent LLM call blocked: per-job token limit exceeded",
      );
      throw new TokenLimitExceededError(`job ${jobId} exceeded its token limit`);
    }
  }

  try {
    const model = registration.model ?? options?.model;
    const { data, usage } = await callLlmStructuredWithUsage(prompt, schema, {
      ...options,
      ...(model ? { model } : {}),
    });

    await db.insertAgentCall({
      agent_id: registration.id,
      agent_name: agentName,
      job_id: jobId ?? null,
      correlation_id: correlationId,
      input_tokens: usage.promptTokens,
      output_tokens: usage.completionTokens,
      status: "success",
      latency_ms: Date.now() - startedAt,
    });

    return data;
  } catch (err) {
    const usage = err instanceof LlmOutputError ? err.usage : { promptTokens: 0, completionTokens: 0 };
    await db.insertAgentCall({
      agent_id: registration.id,
      agent_name: agentName,
      job_id: jobId ?? null,
      correlation_id: correlationId,
      input_tokens: usage.promptTokens,
      output_tokens: usage.completionTokens,
      status: "error",
      error_message: err instanceof Error ? err.message : String(err),
      latency_ms: Date.now() - startedAt,
    });
    throw err;
  }
}
