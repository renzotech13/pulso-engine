import { z } from "zod";

/**
 * One entry per event type the bus carries. Add new entries here as later
 * phases introduce them — this file is the single source of truth the
 * publisher validates against and the dispatcher uses to route to a queue.
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
  "calendar.plan.requested": {
    payload: z.object({}),
    queue: "core",
  },
  "calendar.slots.proposed": {
    payload: z.object({ count: z.number() }),
    queue: "core",
  },
  "news.digest.requested": {
    payload: z.object({}),
    queue: "core",
  },
  "news.suggestions.generated": {
    payload: z.object({ count: z.number() }),
    queue: "core",
  },
  "creative.requested": {
    payload: z.object({ calendarSlotId: z.string().uuid() }),
    queue: "render",
  },
  "creative.generated": {
    payload: z.object({ creativeId: z.string().uuid() }),
    queue: "render",
  },
  "publish.requested": {
    payload: z.object({ creativeId: z.string().uuid() }),
    queue: "publish",
  },
  "publish.completed": {
    payload: z.object({ creativeId: z.string().uuid() }),
    queue: "publish",
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
