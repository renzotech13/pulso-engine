-- Fase A de la conexión con Meta: una fila por tenant con el Page Access
-- Token (obtenido a mano vía Graph API Explorer mientras no haya App Review
-- de Meta) y, opcionalmente, la cuenta de Instagram Business vinculada a
-- esa misma página. Sin flujo OAuth todavía — eso es Fase B.

create table public.social_connections (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null unique references public.tenants (id) on delete cascade,
  page_id text not null,
  page_name text,
  access_token text not null,
  instagram_business_account_id text,
  instagram_username text,
  status text not null default 'active' check (status in ('active', 'invalid')),
  last_verified_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.social_connections enable row level security;
alter table public.social_connections force row level security;

-- A diferencia de brand_kits, esto guarda una credencial real — sin
-- política de select para miembros comunes, solo owner/admin puede verla
-- o tocarla.
create policy social_connections_select on public.social_connections
  for select
  using (private.user_role_for_tenant(tenant_id) in ('owner', 'admin'));

create policy social_connections_insert on public.social_connections
  for insert
  with check (private.user_role_for_tenant(tenant_id) in ('owner', 'admin'));

create policy social_connections_update on public.social_connections
  for update
  using (private.user_role_for_tenant(tenant_id) in ('owner', 'admin'))
  with check (private.user_role_for_tenant(tenant_id) in ('owner', 'admin'));

create trigger social_connections_set_updated_at
  before update on public.social_connections
  for each row
  execute function private.set_updated_at();
