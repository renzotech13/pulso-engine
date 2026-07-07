import { z } from "zod";

/**
 * One entry per event type the bus carries. Add new entries here as later
 * phases introduce them (e.g. `calendar.slot.created` in Fase 1) — this file
 * is the single source of truth the publisher validates against and the
 * dispatcher uses to route to a queue.
 */
export const eventCatalog = {
  "agent.heartbeat.requested": {
    payload: z.object({ reason: z.string() }),
    queue: "core",
  },
  "agent.heartbeat.completed": {
    payload: z.object({ status: z.literal("ok") }),
    queue: "core",
  },
} as const;

export type EventType = keyof typeof eventCatalog;

export type EventPayload<T extends EventType> = z.infer<(typeof eventCatalog)[T]["payload"]>;

export function isKnownEventType(type: string): type is EventType {
  return type in eventCatalog;
}

export function queueForEventType(type: EventType): string {
  return eventCatalog[type].queue;
}

export function parseEventPayload<T extends EventType>(type: T, payload: unknown): EventPayload<T> {
  return eventCatalog[type].payload.parse(payload);
}
