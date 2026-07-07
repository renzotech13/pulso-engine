import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { loadConfig } from "@pulso/shared/config";
import { createLogger } from "@pulso/shared/logger";
import { health } from "./routes/health.js";

loadConfig(); // fail fast at boot if env vars are missing/invalid

const logger = createLogger({ agent: "api" });
const app = new Hono();

app.route("/", health);

const port = Number(process.env.PORT ?? 8787);
serve({ fetch: app.fetch, port }, (info) => {
  logger.info({ port: info.port }, "api listening");
});
