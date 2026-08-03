-- Fase 2: brand kit, plantillas de render (HTML→PNG lazy y Remotion), y
-- las piezas generadas. content_calendar recibe la columna creative_id que
-- quedó pendiente desde Fase 1 — no existía nada a lo que apuntar hasta ahora.

-- ---------------------------------------------------------------------------
-- brand_kits — un kit por tenant (identidad de marca, no algo que varíe
-- por pieza).
-- ---------------------------------------------------------------------------
create table public.brand_kits (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null unique references public.tenants (id) on delete cascade,
  logo_url text,
  color_primary text,
  color_secondary text,
  font_family text,
  tone_description text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.brand_kits enable row level security;
alter table public.brand_kits force row level security;

create policy brand_kits_select on public.brand_kits
  for select
  using (tenant_id in (select private.user_tenant_ids()));

create policy brand_kits_insert on public.brand_kits
  for insert
  with check (private.user_role_for_tenant(tenant_id) in ('owner', 'admin'));

create policy brand_kits_update on public.brand_kits
  for update
  using (private.user_role_for_tenant(tenant_id) in ('owner', 'admin'))
  with check (private.user_role_for_tenant(tenant_id) in ('owner', 'admin'));

create trigger brand_kits_set_updated_at
  before update on public.brand_kits
  for each row
  execute function private.set_updated_at();

-- ---------------------------------------------------------------------------
-- render_templates — tenant_id null = plantilla global disponible para
-- cualquier tenant (mismo patrón que agents_registry/ephemerides).
-- ---------------------------------------------------------------------------
create table public.render_templates (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid references public.tenants (id) on delete cascade,
  name text not null,
  type text not null check (type in ('static', 'video')),
  engine text not null check (engine in ('html', 'remotion')),
  component_ref text not null,
  props_schema jsonb not null default '{}'::jsonb,
  version int not null default 1,
  status text not null default 'draft' check (status in ('draft', 'active', 'disabled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.render_templates enable row level security;
alter table public.render_templates force row level security;

create unique index render_templates_global_name_idx
  on public.render_templates (name) where tenant_id is null;
create unique index render_templates_tenant_name_idx
  on public.render_templates (name, tenant_id) where tenant_id is not null;

create policy render_templates_select on public.render_templates
  for select
  using (tenant_id is null or tenant_id in (select private.user_tenant_ids()));

-- escritura de plantillas queda para service_role (pasan por cola de
-- aprobación humana antes de habilitarse, según la arquitectura original) —
-- sin política de insert/update para authenticated a propósito.

create trigger render_templates_set_updated_at
  before update on public.render_templates
  for each row
  execute function private.set_updated_at();

-- ---------------------------------------------------------------------------
-- creatives — candidatos generados para un slot del calendario. Puede haber
-- varios (variantes A/B, o intentos fallidos); content_calendar.creative_id
-- apunta al que quedó elegido.
-- ---------------------------------------------------------------------------
create table public.creatives (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  calendar_slot_id uuid references public.content_calendar (id) on delete set null,
  template_id uuid references public.render_templates (id),
  type text not null check (type in ('image', 'carousel', 'video')),
  brief jsonb not null default '{}'::jsonb,
  status text not null default 'pending'
    check (status in ('pending', 'rendering', 'ready', 'approved', 'failed')),
  asset_urls text[] not null default array[]::text[],
  variant_group_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.creatives enable row level security;
alter table public.creatives force row level security;

create index creatives_tenant_created_idx on public.creatives (tenant_id, created_at desc);
create index creatives_calendar_slot_idx on public.creatives (calendar_slot_id);

create policy creatives_select on public.creatives
  for select
  using (tenant_id in (select private.user_tenant_ids()));

create policy creatives_update on public.creatives
  for update
  using (private.user_role_for_tenant(tenant_id) in ('owner', 'admin'))
  with check (private.user_role_for_tenant(tenant_id) in ('owner', 'admin'));

create trigger creatives_set_updated_at
  before update on public.creatives
  for each row
  execute function private.set_updated_at();

alter table public.content_calendar
  add column creative_id uuid references public.creatives (id) on delete set null;

-- ---------------------------------------------------------------------------
-- creative-assets — igual que product-media: público a propósito, son
-- piezas que van a terminar publicadas en redes.
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('creative-assets', 'creative-assets', true)
on conflict (id) do nothing;

create policy "tenant members can upload their creative assets"
  on storage.objects for insert
  with check (
    bucket_id = 'creative-assets'
    and (storage.foldername(name))[1]::uuid in (select private.user_tenant_ids())
  );

create policy "tenant members can delete their creative assets"
  on storage.objects for delete
  using (
    bucket_id = 'creative-assets'
    and (storage.foldername(name))[1]::uuid in (select private.user_tenant_ids())
  );
