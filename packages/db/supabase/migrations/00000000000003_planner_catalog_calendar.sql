-- Fase 1: Planner + efemérides.
-- business_categories (rubro extensible sin migración), ephemerides,
-- products_services, promotions, content_calendar, prompts.

-- ---------------------------------------------------------------------------
-- business_categories — lookup table, no un enum: agregar un rubro nuevo
-- ("óptica", "barbería", lo que sea) es un INSERT, nunca una migración.
-- ---------------------------------------------------------------------------
create table public.business_categories (
  slug text primary key,
  name text not null,
  created_at timestamptz not null default now()
);

alter table public.business_categories enable row level security;
alter table public.business_categories force row level security;

create policy business_categories_select on public.business_categories
  for select
  using (true);

-- writes van solo por seed/migración (service_role bypasses RLS), no hay
-- política de insert/update/delete para authenticated/anon a propósito.

alter table public.tenants
  add column rubro text references public.business_categories (slug);

-- ---------------------------------------------------------------------------
-- ephemerides — globales/PE (tenant_id null) + custom por tenant.
-- Fechas móviles (Día de la Madre, etc.) se preresuelven en el seed como una
-- fila concreta por año en vez de un motor de reglas de recurrencia.
-- ---------------------------------------------------------------------------
create table public.ephemerides (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid references public.tenants (id) on delete cascade,
  country_code text,
  name text not null,
  date date not null,
  is_recurring_annually boolean not null default false,
  relevance_tags text[] not null default array['general']::text[],
  category text not null default 'comercial'
    check (category in ('nacional', 'internacional', 'comercial', 'religiosa')),
  created_at timestamptz not null default now()
);

alter table public.ephemerides enable row level security;
alter table public.ephemerides force row level security;

create index ephemerides_date_idx on public.ephemerides (date);

create policy ephemerides_select on public.ephemerides
  for select
  using (tenant_id is null or tenant_id in (select private.user_tenant_ids()));

create policy ephemerides_insert on public.ephemerides
  for insert
  with check (
    tenant_id is not null
    and private.user_role_for_tenant(tenant_id) in ('owner', 'admin')
  );

-- ---------------------------------------------------------------------------
-- products_services
-- ---------------------------------------------------------------------------
create table public.products_services (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  name text not null,
  description text,
  price numeric(10, 2),
  currency text not null default 'PEN',
  photo_urls text[] not null default array[]::text[],
  category text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.products_services enable row level security;
alter table public.products_services force row level security;

create index products_services_tenant_idx on public.products_services (tenant_id);

create policy products_services_select on public.products_services
  for select
  using (tenant_id in (select private.user_tenant_ids()));

create policy products_services_insert on public.products_services
  for insert
  with check (private.user_role_for_tenant(tenant_id) in ('owner', 'admin'));

create policy products_services_update on public.products_services
  for update
  using (private.user_role_for_tenant(tenant_id) in ('owner', 'admin'))
  with check (private.user_role_for_tenant(tenant_id) in ('owner', 'admin'));

create trigger products_services_set_updated_at
  before update on public.products_services
  for each row
  execute function private.set_updated_at();

-- ---------------------------------------------------------------------------
-- promotions
-- ---------------------------------------------------------------------------
create table public.promotions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  name text not null,
  description text,
  discount_type text not null check (discount_type in ('percentage', 'fixed_amount')),
  discount_value numeric(10, 2) not null,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  conditions text,
  product_ids uuid[] not null default array[]::uuid[],
  active boolean not null default true,
  created_at timestamptz not null default now()
);

alter table public.promotions enable row level security;
alter table public.promotions force row level security;

create index promotions_tenant_idx on public.promotions (tenant_id);

create policy promotions_select on public.promotions
  for select
  using (tenant_id in (select private.user_tenant_ids()));

create policy promotions_insert on public.promotions
  for insert
  with check (private.user_role_for_tenant(tenant_id) in ('owner', 'admin'));

create policy promotions_update on public.promotions
  for update
  using (private.user_role_for_tenant(tenant_id) in ('owner', 'admin'))
  with check (private.user_role_for_tenant(tenant_id) in ('owner', 'admin'));

-- ---------------------------------------------------------------------------
-- content_calendar — un slot por día por tenant (simplificación de Fase 1;
-- el target típico -spa/restaurante local- publica ~1x/día).
-- ---------------------------------------------------------------------------
create table public.content_calendar (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  date date not null,
  slot_type text not null check (slot_type in ('post', 'carousel', 'story', 'reel')),
  theme text not null,
  status text not null default 'draft' check (status in ('draft', 'approved', 'skipped')),
  source jsonb not null default '{}'::jsonb,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, date)
);

alter table public.content_calendar enable row level security;
alter table public.content_calendar force row level security;

create index content_calendar_tenant_date_idx on public.content_calendar (tenant_id, date);

create policy content_calendar_select on public.content_calendar
  for select
  using (tenant_id in (select private.user_tenant_ids()));

-- inserts los hace el Planner (service_role); el dashboard solo edita lo
-- que el Planner ya propuso.
create policy content_calendar_update on public.content_calendar
  for update
  using (private.user_role_for_tenant(tenant_id) in ('owner', 'admin'))
  with check (private.user_role_for_tenant(tenant_id) in ('owner', 'admin'));

create trigger content_calendar_set_updated_at
  before update on public.content_calendar
  for each row
  execute function private.set_updated_at();

-- ---------------------------------------------------------------------------
-- prompts — versionados en DB, no hardcodeados en el código del agente.
-- Tabla global (no tenant-scoped); solo service_role la toca.
-- ---------------------------------------------------------------------------
create table public.prompts (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  version int not null,
  template text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (name, version)
);

alter table public.prompts enable row level security;
alter table public.prompts force row level security;

-- sin políticas para authenticated/anon a propósito: solo el Planner
-- (service_role) necesita leer esto.

-- ---------------------------------------------------------------------------
-- onboarding: create_tenant_with_owner ahora también recibe el rubro.
-- ---------------------------------------------------------------------------
drop function if exists public.create_tenant_with_owner(text, text);

create or replace function public.create_tenant_with_owner(
  tenant_name text,
  tenant_slug text,
  tenant_rubro text
)
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

  insert into public.tenants (name, slug, rubro)
  values (tenant_name, tenant_slug, tenant_rubro)
  returning * into new_tenant;

  insert into public.memberships (tenant_id, user_id, role)
  values (new_tenant.id, auth.uid(), 'owner');

  return new_tenant;
end;
$$;

revoke all on function public.create_tenant_with_owner(text, text, text) from public;
grant execute on function public.create_tenant_with_owner(text, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- request_calendar_regeneration — el botón "Regenerar" del dashboard dispara
-- esto en vez de insertar directo en `events` (para lo que no hay política
-- de insert). Mismo evento que usa el tick diario del Planner.
-- ---------------------------------------------------------------------------
create or replace function public.request_calendar_regeneration(target_tenant_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if private.user_role_for_tenant(target_tenant_id) is null then
    raise exception 'not a member of this tenant';
  end if;

  insert into public.events (tenant_id, type, payload, correlation_id)
  values (target_tenant_id, 'calendar.plan.requested', '{}'::jsonb, gen_random_uuid());
end;
$$;

revoke all on function public.request_calendar_regeneration(uuid) from public;
grant execute on function public.request_calendar_regeneration(uuid) to authenticated;
