import { fileURLToPath } from "node:url";
import path from "node:path";
import { config as loadDotenv } from "dotenv";
import { z } from "zod";

// This file always lives at <repo-root>/packages/shared/src/config.ts in the
// workspace (never copied/hoisted), so this resolves to the repo root
// regardless of which app imports it or what its own cwd is. Next.js loads
// its own apps/web/.env.local separately and already populates process.env
// by the time this runs, so this is a no-op there (dotenv never overwrites
// existing keys).
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
loadDotenv({ path: path.join(repoRoot, ".env") });

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).default("info"),

  SUPABASE_URL: z.string().url(),
  SUPABASE_ANON_KEY: z.string().min(1),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),

  REDIS_URL: z.string().min(1),

  SENTRY_DSN: z.preprocess((v) => (v === "" ? undefined : v), z.string().url().optional()),

  // Local LLM served by LM Studio (OpenAI-compatible endpoint) — replaces a
  // hosted LLM API entirely, so agents that reason (Planner, later Creative)
  // require LM Studio running locally with a model loaded.
  LMSTUDIO_BASE_URL: z.string().url().default("http://127.0.0.1:1234/v1"),
  LMSTUDIO_MODEL: z.string().min(1),

  // Same service apps/web already reaches via NEXT_PUBLIC_RENDER_TEMPLATES_URL
  // — apps/workers needs its own copy to trigger eager renders for tenants in
  // an auto hitl_mode, instead of waiting for someone to view the page.
  RENDER_TEMPLATES_URL: z.string().url().default("http://localhost:3001"),

  // Optional on purpose: unset means the AI-image-generation fallback in
  // creative.ts simply never activates (no gradient-vs-photo behavior
  // changes, no risk of unexpected API spend) until a tenant/operator adds one.
  GEMINI_API_KEY: z.preprocess((v) => (v === "" ? undefined : v), z.string().min(1).optional()),
});

export type AppConfig = z.infer<typeof envSchema>;

let cached: AppConfig | undefined;

/**
 * Parses `process.env` on first call and caches the result. Throws
 * immediately with a readable message if required vars are missing —
 * every app/worker must call this at bootstrap, not lazily.
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  if (cached) return cached;

  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `  - ${issue.path.join(".")}: ${issue.message}`)
      .join("\n");
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }

  cached = parsed.data;
  return cached;
}

export function resetConfigCacheForTests(): void {
  cached = undefined;
}
