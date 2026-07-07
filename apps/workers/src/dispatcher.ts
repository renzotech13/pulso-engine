import { createServiceRoleClient } from "@pulso/db/worker";
import { isKnownEventType, queueForEventType } from "@pulso/events/catalog";
import { publishRealtimeEvent } from "@pulso/events/realtime";
import { createLogger } from "@pulso/shared/logger";
import { getQueue, getRedisConnection, type QueueName } from "./queues.js";

const logger = createLogger({ agent: "dispatcher" });
const POLL_INTERVAL_MS = 1000;
const BATCH_SIZE = 100;
const MAX_ATTEMPTS = 5;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Polls the outbox via `claim_pending_events` (atomic FOR UPDATE SKIP LOCKED
 * claim under the hood — see migration 00000000000002) and routes each
 * claimed event to its BullMQ queue. jobId is the event's own id, so a
 * duplicate claim (e.g. after a crash mid-dispatch) never double-enqueues.
 */
export function startDispatcher(): () => void {
  let stopped = false;

  const loop = async () => {
    while (!stopped) {
      try {
        await dispatchOnce();
      } catch (err) {
        logger.error({ err }, "dispatcher tick failed");
      }
      await sleep(POLL_INTERVAL_MS);
    }
  };

  void loop();
  return () => {
    stopped = true;
  };
}

async function dispatchOnce(): Promise<void> {
  const service = createServiceRoleClient();
  const { data: claimed, error } = await service.rpc("claim_pending_events", {
    batch_size: BATCH_SIZE,
  });

  if (error) {
    logger.error({ err: error }, "failed to claim pending events");
    return;
  }
  if (!claimed || claimed.length === 0) return;

  const redis = getRedisConnection();

  for (const event of claimed) {
    try {
      if (!isKnownEventType(event.type)) {
        throw new Error(`unknown event type: ${event.type}`);
      }

      const queue = getQueue(queueForEventType(event.type) as QueueName);
      await queue.add(event.type, event, { jobId: event.id });

      await publishRealtimeEvent(redis, {
        tenantId: event.tenant_id,
        type: event.type,
        correlationId: event.correlation_id,
        createdAt: event.created_at,
      });
    } catch (err) {
      await handleDispatchFailure(service, event, err);
    }
  }
}

async function handleDispatchFailure(
  service: ReturnType<typeof createServiceRoleClient>,
  event: { id: string; tenant_id: string; type: string; attempts: number },
  err: unknown,
): Promise<void> {
  const message = err instanceof Error ? err.message : String(err);
  logger.error({ err, eventId: event.id, attempts: event.attempts }, "failed to dispatch event");

  if (event.attempts >= MAX_ATTEMPTS) {
    await service
      .from("events")
      .update({ status: "failed", last_error: message })
      .eq("id", event.id);

    await service.from("alerts").insert({
      tenant_id: event.tenant_id,
      severity: "critical",
      type: "event_dispatch_failed",
      message: `event ${event.id} (${event.type}) failed to dispatch after ${event.attempts} attempts: ${message}`,
    });
    return;
  }

  await service
    .from("events")
    .update({ status: "pending", last_error: message })
    .eq("id", event.id);
}
