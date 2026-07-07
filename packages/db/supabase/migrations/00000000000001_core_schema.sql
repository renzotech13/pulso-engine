-- Fase 0: fundaciones multi-tenant.
-- tenants, memberships, outbox de eventos, agent_runs, decision_log, alerts.
-- Todas las tablas tienen RLS habilitado y forzado por tenant_id.

create schema if not exists private;

-- ---------------------------------------------------------------------------
-- tenants
-- ---------------------------------------------------------------------------
create table public.tenants (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  hitl_mode text not null default 'approve-all'
    check (hitl_mode in ('full-auto', 'approve-creatives', 'approve-all')),
  status text not null default 'active'
    check (status in ('active', 'paused', 'archived')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.tenants enable row level security;
alter table public.tenants force row level security;

-- ---------------------------------------------------------------------------
-- memberships
-- ---------------------------------------------------------------------------
create table public.memberships (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role text not null default 'viewer'
    check (role in ('owner', 'admin', 'viewer')),
  created_at timestamptz not null default now(),
  unique (tenant_id, user_id)
);

alter table public.memberships enable row level security;
alter table public.memberships force row level security;

create index memberships_user_id_idx on public.memberships (user_id);

-- ---------------------------------------------------------------------------
-- helper: tenant ids the current JWT belongs to.
-- security definer + stable so it can be used inside RLS policies without
-- re-querying memberships (and its own RLS) once per row.
-- ---------------------------------------------------------------------------
create or replace function private.user_tenant_ids()
returns setof uuid
language sql
security definer
stable
set search_path = public
as $$
  select tenant_id
  from public.memberships
  where user_id = auth.uid()
$$;

create or replace function private.user_role_for_tenant(check_tenant_id uuid)
returns text
language sql
security definer
stable
set search_path = public
as $$
  select role
  from public.memberships
  where user_id = auth.uid()
    and tenant_id = check_tenant_id
  limit 1
$$;

-- tenants: visible/editable only to members; only owners/admins can update.
create policy tenants_select on public.tenants
  for select
  using (id in (select private.user_tenant_ids()));

create policy tenants_update on public.tenants
  for update
  using (private.user_role_for_tenant(id) in ('owner', 'admin'))
  with check (private.user_role_for_tenant(id) in ('owner', 'admin'));

-- memberships: members can see other members of their own tenants;
-- only owners can manage membership.
create policy memberships_select on public.memberships
  for select
  using (tenant_id in (select private.user_tenant_ids()));

create policy memberships_insert on public.memberships
  for insert
  with check (private.user_role_for_tenant(tenant_id) = 'owner');

create policy memberships_update on public.memberships
  for update
  using (private.user_role_for_tenant(tenant_id) = 'owner')
  with check (private.user_role_for_tenant(tenant_id) = 'owner');

create policy memberships_delete on public.memberships
  for delete
  using (private.user_role_for_tenant(tenant_id) = 'owner');

-- ---------------------------------------------------------------------------
-- events (outbox)
-- ---------------------------------------------------------------------------
create table public.events (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  type text not null,
  payload jsonb not null default '{}'::jsonb,
  correlation_id uuid not null default gen_random_uuid(),
  status text not null default 'pending'
    check (status in ('pending', 'dispatched', 'failed')),
  attempts int not null default 0,
  last_error text,
  created_at timestamptz not null default now(),
  dispatched_at timestamptz
);

alter table public.events enable row level security;
alter table public.events force row level security;

create index events_dispatch_idx on public.events (status, created_at);
create index events_tenant_created_idx on public.events (tenant_id, created_at);
create index events_correlation_idx on public.events (correlation_id);

create policy events_select on public.events
  for select
  using (tenant_id in (select private.user_tenant_ids()));

-- inserts happen through service-role workers/RPCs, not directly by end users;
-- no insert/update/delete policy for authenticated role is defined on purpose.

-- ---------------------------------------------------------------------------
-- agent_runs (append-only audit trail)
-- ---------------------------------------------------------------------------
create table public.agent_runs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  agent text not null,
  trigger text not null,
  status text not null default 'running'
    check (status in ('running', 'succeeded', 'failed')),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  cost_usd numeric(10, 4) not null default 0,
  result jsonb,
  error text,
  correlation_id uuid not null
);

alter table public.agent_runs enable row level security;
alter table public.agent_runs force row level security;

create index agent_runs_tenant_started_idx on public.agent_runs (tenant_id, started_at desc);
create index agent_runs_correlation_idx on public.agent_runs (correlation_id);

create policy agent_runs_select on public.agent_runs
  for select
  using (tenant_id in (select private.user_tenant_ids()));

-- append-only: revoke update/delete from all non-superuser roles so not even
-- an owner or a compromised service-role query can rewrite history.
revoke update, delete on public.agent_runs from authenticated, anon, service_role;

-- ---------------------------------------------------------------------------
-- decision_log (append-only audit trail)
-- ---------------------------------------------------------------------------
create table public.decision_log (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  agent text not null,
  observed jsonb not null default '{}'::jsonb,
  decision jsonb not null default '{}'::jsonb,
  rationale text,
  outcome jsonb,
  correlation_id uuid not null,
  created_at timestamptz not null default now()
);

alter table public.decision_log enable row level security;
alter table public.decision_log force row level security;

create index decision_log_tenant_created_idx on public.decision_log (tenant_id, created_at desc);
create index decision_log_correlation_idx on public.decision_log (correlation_id);

create policy decision_log_select on public.decision_log
  for select
  using (tenant_id in (select private.user_tenant_ids()));

revoke update, delete on public.decision_log from authenticated, anon, service_role;

-- ---------------------------------------------------------------------------
-- alerts
-- ---------------------------------------------------------------------------
create table public.alerts (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  severity text not null default 'info'
    check (severity in ('info', 'warning', 'critical')),
  type text not null,
  message text not null,
  created_at timestamptz not null default now(),
  acknowledged_at timestamptz
);

alter table public.alerts enable row level security;
alter table public.alerts force row level security;

create index alerts_tenant_created_idx on public.alerts (tenant_id, created_at desc);

create policy alerts_select on public.alerts
  for select
  using (tenant_id in (select private.user_tenant_ids()));

create policy alerts_update on public.alerts
  for update
  using (tenant_id in (select private.user_tenant_ids()))
  with check (tenant_id in (select private.user_tenant_ids()));

-- ---------------------------------------------------------------------------
-- updated_at trigger for tenants
-- ---------------------------------------------------------------------------
create or replace function private.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger tenants_set_updated_at
  before update on public.tenants
  for each row
  execute function private.set_updated_at();

-- ---------------------------------------------------------------------------
-- signup: a brand-new user has no membership yet, so the normal RLS-gated
-- insert policies can never let them create their first tenant. This
-- SECURITY DEFINER RPC creates the tenant + owner membership atomically;
-- auth.uid() still resolves to the calling user's JWT regardless of the
-- elevated definer privileges.
-- ---------------------------------------------------------------------------
create or replace function public.create_tenant_with_owner(tenant_name text, tenant_slug text)
returns public.tenants
language plpgsql
security definer
set search_path = public
as $$
declare
  new_tenant public.tenants;
begin
  if auth.uid() is null then
    raise exception 'authentication required';
  end if;

  insert into public.tenants (name, slug)
  values (tenant_name, tenant_slug)
  returning * into new_tenant;

  insert into public.memberships (tenant_id, user_id, role)
  values (new_tenant.id, auth.uid(), 'owner');

  return new_tenant;
end;
$$;

revoke all on function public.create_tenant_with_owner(text, text) from public;
grant execute on function public.create_tenant_with_owner(text, text) to authenticated;
