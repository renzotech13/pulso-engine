import pino, { type LoggerOptions } from "pino";

export interface LogContext {
  tenantId?: string;
  correlationId?: string;
  agent?: string;
  [key: string]: unknown;
}

const options: LoggerOptions = { level: process.env.LOG_LEVEL ?? "info" };
if (process.env.NODE_ENV !== "production") {
  options.transport = { target: "pino-pretty", options: { colorize: true } };
}

const root = pino(options);

export function createLogger(context: LogContext = {}) {
  return root.child(context);
}

export type Logger = ReturnType<typeof createLogger>;
