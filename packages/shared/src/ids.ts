import { randomUUID } from "node:crypto";
import { createHash } from "node:crypto";

export function newCorrelationId(): string {
  return randomUUID();
}

/**
 * Deterministic jobId from stable inputs, so BullMQ dedupes retries of the
 * same logical work instead of enqueuing duplicates (idempotent jobs).
 */
export function deterministicJobId(parts: readonly string[]): string {
  return createHash("sha256").update(parts.join(":")).digest("hex");
}
