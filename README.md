# Pulso Engine

SaaS multi-tenant de agentes autónomos de marketing para negocios locales (spas, restaurantes, tiendas, gimnasios, mueblerías, joyerías). El sistema planifica, crea, publica, pauta y optimiza contenido y anuncios en loop continuo, alimentándose de métricas reales del sitio web, CRM y WhatsApp del negocio.

## Estado actual: Fase 0 completa (Fase 1 en pausa)

Solo la **Fase 0 — Fundaciones** está construida, commiteada y verificada en vivo. Es el esqueleto de infraestructura sobre el que corren los agentes; **no incluye todavía** planificación editorial, creación de piezas, publicación, ads ni el ciclo de aprendizaje — eso es lo que definían las Fases 1–6, que están pausadas mientras se acota el alcance del proyecto.

## Qué hay construido (Fase 0)

**Monorepo:** Turborepo + pnpm, TypeScript strict en todo, Zod en los bordes.

```
apps/
  web/       Next.js 15 — dashboard (auth, selector de tenant, vistas en vivo)
  api/       Hono — solo healthcheck por ahora
  workers/   procesos Node long-running — dispatcher del outbox + agentes
  remotion/  placeholder vacío (llega en Fase 2)
packages/
  db/        schema SQL + RLS, clientes tipados (server/worker), seed, tests
  events/    catálogo de eventos (Zod) + publisher del outbox + realtime
  shared/    config (Zod, fail-fast), logger (pino), errors, ids
  integrations/  vacío, reservado para Fase 3+
tooling/
  tsconfig/, eslint-config/   config compartida
```

**Base de datos:** Postgres (Supabase) con RLS habilitado y forzado en cada tabla (`tenants`, `memberships`, `events`, `agent_runs`, `decision_log`, `alerts`), verificado con una suite de 8 tests que confirma aislamiento total entre tenants. `agent_runs` y `decision_log` son append-only de verdad: se revocó UPDATE/DELETE a nivel de grants, no solo con políticas.

**Loop "hello world" auditable:** un Orchestrator con tick cada 60s emite un evento por tenant → outbox (`events`, patrón transaccional con claim atómico `FOR UPDATE SKIP LOCKED`) → dispatcher → colas BullMQ (`core`, `render`, `publish`, `ads`, `analytics`, `whatsapp-outbound`) → un agente de prueba (`hello`) que corre, escribe su decisión en `decision_log` y cierra el ciclo. Cada ejecución queda registrada en `agent_runs` con duración y resultado. Se verificó corriendo varios ciclos seguidos, incluyendo recuperación automática sin duplicados tras reiniciar el stack de Supabase a medio ciclo.

**Dashboard:** login por magic link (Supabase Auth), selector de tenant, vista en vivo de `agent_runs` y del stream de `events` — probado de punta a punta en navegador real, no solo compilado.

**Seed demo:** dos tenants aislados (`spa-demo-a`, `spa-demo-b`) con un owner cada uno, para desarrollo local y para la suite de RLS.

## Cómo correrlo localmente

Requiere Docker Desktop corriendo.

```bash
corepack enable                      # si no tienes pnpm
pnpm install

cd packages/db && supabase start     # Postgres + Auth + Studio + Mailpit locales
cd ../..
docker compose -f docker-compose.dev.yml up -d   # Redis

cp .env.example .env                 # completa con las credenciales que imprime `supabase status`
cp .env.example apps/web/.env.local  # Next.js solo lee .env desde su propio directorio

pnpm db:seed                         # crea los 2 tenants demo
pnpm --filter @pulso/db test         # suite de aislamiento RLS

pnpm dev                             # web (:3000) + api (:8787) + workers
```

Login: cualquiera de los emails sembrados (`owner-a@pulso.test` / `owner-b@pulso.test`) por magic link — en local el correo llega a Mailpit (`http://127.0.0.1:54324`), no a una bandeja real.

## Stack

Next.js 15 · TypeScript strict · Supabase (Postgres + RLS + Auth) · BullMQ + Redis · Hono · Tailwind · pino · Zod. LLM (Claude), Remotion, Meta/WhatsApp APIs y el resto de integraciones llegan en fases posteriores, todavía no implementadas.

## Deuda / riesgos conocidos

- El dispatcher del outbox es polling simple (1s); no hay ventana cubierta más allá de reintentos con escalado a `alerts` tras 5 intentos.
- No hay pooler de conexiones a Postgres configurado.
- El primer `docker pull` en una máquina nueva puede colgarse si Docker Desktop pide aprobación de Keychain para `docker-credential-desktop` — hay que aprobarlo una vez manualmente desde una Terminal normal.
- No hay CI corrido en GitHub todavía (el workflow existe en `.github/workflows/ci.yml` pero no se ha empujado a un remoto).
