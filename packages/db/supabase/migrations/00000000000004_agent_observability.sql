-- Capa de control y observabilidad de agentes/LLM.
-- agents_registry (catálogo + kill switch), agent_calls (auditoría de cada
-- llamada al LLM), límites de tokens por tenant. No agrega inteligencia
-- nueva ni llamadas extra al LLM — usage.* ya viene gratis en cada response.

-- ---------------------------------------------------------------------------
-- agents_registry — catálogo de agentes. tenant_id null = agente global del
-- sistema (hello, orchestrator, planner); no-null = agente custom de un
-- tenant específico, para cuando el sistema de plugins lo permita.
-- ---------------------------------------------------------------------------
create table public.agents_registry (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  version int not null default 1,
  allowed_tools jsonb not null default '[]'::jsonb,
  -- referencia a prompts.name (no una FK compuesta: un agente usa la
  -- versión *activa* de su prompt, ya resuelta por getActivePrompt()).
  prompt_name text,
  -- null = usa LMSTUDIO_MODEL del env; seteado = override por agente
  -- (equivalente costo-cero al balanceo de modelos de un LLM gateway real).
  model text,
  status text not null default 'active' check (status in ('active', 'disabled')),
  tenant_id uuid references public.tenants (id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.agents_registry enable row level security;
alter table public.agents_registry force row level security;

create unique index agents_registry_global_name_idx
  on public.agents_registry (name) where tenant_id is null;
create unique index agents_registry_tenant_name_idx
  on public.agents_registry (name, tenant_id) where tenant_id is not null;

create policy agents_registry_select on public.agents_registry
  for select
  using (tenant_id is null or tenant_id in (select private.user_tenant_ids()));

-- sin políticas de insert/update/delete para authenticated/anon: solo
-- service_role administra el registro (kill switch incluido).

create trigger agents_registry_set_updated_at
  before update on public.agents_registry
  for each row
  execute function private.set_updated_at();

-- ---------------------------------------------------------------------------
-- agent_calls — una fila por llamada al LLM (no por corrida de agente:
-- agent_runs ya cubre eso). Append-only, mismo patrón que agent_runs/
-- decision_log: UPDATE/DELETE revocados a nivel de grants.
-- ---------------------------------------------------------------------------
create table public.agent_calls (
  id uuid primary key default gen_random_uuid(),
  -- nullable on purpose: a call blocked because the agent name isn't
  -- registered *at all* has no valid agents_registry row to point at.
  -- agent_name is always set (it's whatever the caller asked for) so a
  -- fully-unknown agent still gets an auditable row.
  agent_id uuid references public.agents_registry (id),
  agent_name text not null,
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  job_id text,
  correlation_id uuid,
  input_tokens int not null default 0,
  output_tokens int not null default 0,
  -- siempre 0 con LM Studio (local, sin costo); el campo queda listo por si
  -- algún día se reintroduce un proveedor de pago.
  cost_estimated_usd numeric(12, 6) not null default 0,
  latency_ms int not null default 0,
  status text not null check (status in ('success', 'error', 'blocked')),
  error_message text,
  created_at timestamptz not null default now()
);

alter table public.agent_calls enable row level security;
alter table public.agent_calls force row level security;

create index agent_calls_tenant_created_idx on public.agent_calls (tenant_id, created_at desc);
create index agent_calls_agent_idx on public.agent_calls (agent_id);

create policy agent_calls_select on public.agent_calls
  for select
  using (tenant_id in (select private.user_tenant_ids()));

revoke update, delete on public.agent_calls from authenticated, anon, service_role;

-- ---------------------------------------------------------------------------
-- límites por tenant. Con LM Studio no protegen presupuesto, protegen la
-- máquina local: un agente en loop quemando el modelo satura la cola y el
-- equipo. Si algún día vuelve un proveedor de pago, el mismo freno aplica.
-- null = sin límite.
-- ---------------------------------------------------------------------------
alter table public.tenants
  add column token_limit_daily bigint,
  add column token_limit_per_job bigint;
