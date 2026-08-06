import type { ServiceRoleClient } from "@pulso/db/worker";
import { AppError } from "@pulso/shared/errors";
import { newCorrelationId } from "@pulso/shared/ids";
// Self-referencing package-subpath import, not a relative "./x.js" path —
// see packages/publish/src/publish.ts for why (Next's webpack can't resolve
// a NodeNext-style ".js" extension pointing at an unbuilt ".ts" file, even
// with transpilePackages set, for anything beyond type-only imports).
import { type EventType, type EventPayload, parseEventPayload } from "@pulso/events/catalog";

export interface PublishEventInput<T extends EventType> {
  tenantId: string;
  type: T;
  payload: EventPayload<T>;
  correlationId?: string;
}

/**
 * Inserts one row into the `events` outbox table. Payload is validated
 * against the catalog schema before it ever reaches Postgres.
 *
 * NOTE: true outbox semantics require this insert to run in the same
 * transaction as whatever domain write it accompanies. supabase-js issues
 * one HTTP request per call, so it cannot join an existing transaction —
 * once a phase needs that (e.g. Planner writing a calendar slot + emitting
 * an event atomically), wrap both writes in a single Postgres function and
 * call that via `.rpc()` instead of calling this directly from that path.
 * Fase 0's heartbeat has no accompanying domain write, so a plain insert is
 * correct here.
 */
export async function publishEvent<T extends EventType>(
  client: ServiceRoleClient,
  input: PublishEventInput<T>,
): Promise<string> {
  const payload = parseEventPayload(input.type, input.payload);
  const correlationId = input.correlationId ?? newCorrelationId();

  const { data, error } = await client
    .from("events")
    .insert({
      tenant_id: input.tenantId,
      type: input.type,
      payload,
      correlation_id: correlationId,
    })
    .select("id")
    .single();

  if (error || !data) {
    throw new AppError(`failed to publish event ${input.type}`, "EVENT_PUBLISH_FAILED", error);
  }

  return data.id;
}
