-- ---------------------------------------------------------------------------
-- media_assets — a tenant's own pool of real uploaded photos/videos, used as
-- the Creative agent's preferred image source (ahead of AI-generated images)
-- for regular posts that aren't about a specific catalog product. Rotation
-- is last_used_at-based (oldest/never-used picked first), not consumed —
-- the pool cycles back around once everything's been used at least once.
-- ---------------------------------------------------------------------------
create table public.media_assets (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  kind text not null default 'image' check (kind in ('image', 'video')),
  url text not null,
  last_used_at timestamptz,
  created_at timestamptz not null default now()
);

alter table public.media_assets enable row level security;
alter table public.media_assets force row level security;

create index media_assets_tenant_kind_idx on public.media_assets (tenant_id, kind, last_used_at);

create policy media_assets_select on public.media_assets
  for select
  using (tenant_id in (select private.user_tenant_ids()));

create policy media_assets_insert on public.media_assets
  for insert
  with check (
    tenant_id is not null
    and tenant_id in (select private.user_tenant_ids())
    and private.user_role_for_tenant(tenant_id) in ('owner', 'admin')
  );

create policy media_assets_delete on public.media_assets
  for delete
  using (private.user_role_for_tenant(tenant_id) in ('owner', 'admin'));
