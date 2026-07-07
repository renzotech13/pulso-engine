import { Queue } from "bullmq";
import { Redis } from "ioredis";
import { loadConfig } from "@pulso/shared/config";

export type QueueName = "core" | "render" | "publish" | "ads" | "analytics" | "whatsapp-outbound";

let connection: Redis | undefined;

export function getRedisConnection(): Redis {
  if (!connection) {
    const config = loadConfig();
    connection = new Redis(config.REDIS_URL, { maxRetriesPerRequest: null });
  }
  return connection;
}

const queues = new Map<QueueName, Queue>();

export function getQueue(name: QueueName): Queue {
  let queue = queues.get(name);
  if (!queue) {
    queue = new Queue(name, { connection: getRedisConnection() });
    queues.set(name, queue);
  }
  return queue;
}

export async function closeAllQueues(): Promise<void> {
  await Promise.all([...queues.values()].map((queue) => queue.close()));
  queues.clear();
  if (connection) {
    await connection.quit();
    connection = undefined;
  }
}
