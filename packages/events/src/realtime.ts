import { Redis } from "ioredis";

export interface RealtimeEvent {
  tenantId: string;
  type: string;
  correlationId: string;
  createdAt: string;
}

function channelForTenant(tenantId: string): string {
  return `pulso:events:${tenantId}`;
}

/**
 * Fan-out only — this is for the dashboard's live event stream, not a
 * delivery guarantee. The outbox table remains the durable source of truth;
 * a dropped pub/sub message just means the UI updates on next poll instead.
 */
export async function publishRealtimeEvent(redis: Redis, event: RealtimeEvent): Promise<void> {
  await redis.publish(channelForTenant(event.tenantId), JSON.stringify(event));
}

export function subscribeToTenantEvents(
  redis: Redis,
  tenantId: string,
  onEvent: (event: RealtimeEvent) => void,
): () => void {
  const channel = channelForTenant(tenantId);

  const handler = (receivedChannel: string, message: string) => {
    if (receivedChannel !== channel) return;
    onEvent(JSON.parse(message) as RealtimeEvent);
  };

  redis.subscribe(channel);
  redis.on("message", handler);

  return () => {
    redis.off("message", handler);
    void redis.unsubscribe(channel);
  };
}
