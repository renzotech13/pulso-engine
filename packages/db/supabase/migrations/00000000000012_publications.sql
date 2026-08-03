-- Agente Publish: consume `publish.requested`, postea el creative aprobado
-- en las plataformas conectadas (Meta Graph API). Una fila por plataforma
-- por creative — un mismo creative puede publicarse en Facebook e
-- Instagram con resultados independientes.

create table public.publications (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  creative_id uuid not null references public.creatives (id) on delete cascade,
  platform text not null check (platform in ('facebook', 'instagram')),
  status text not null default 'pending' check (status in ('pending', 'published', 'failed')),
  external_post_id text,
  error_message text,
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.publications enable row level security;
alter table public.publications force row level security;

create index publications_creative_idx on public.publications (creative_id);

create policy publications_select on public.publications
  for select
  using (tenant_id in (select private.user_tenant_ids()));

-- Sin política de insert/update para authenticated a propósito — solo el
-- agente Publish (service_role) escribe acá, igual que render_templates.

create trigger publications_set_updated_at
  before update on public.publications
  for each row
  execute function private.set_updated_at();

-- ---------------------------------------------------------------------------
-- request_creative_publish — el botón "Publicar" en /calendar dispara esto.
-- Mismo patrón que request_creative_generation: valida rol y encola el
-- evento, la idempotencia y el trabajo real viven en el agente.
-- ---------------------------------------------------------------------------
create or replace function public.request_creative_publish(target_creative_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  creative_tenant_id uuid;
begin
  select tenant_id into creative_tenant_id
  from public.creatives
  where id = target_creative_id;

  if creative_tenant_id is null then
    raise exception 'creative not found';
  end if;

  if private.user_role_for_tenant(creative_tenant_id) not in ('owner', 'admin') then
    raise exception 'not a member of this tenant';
  end if;

  insert into public.events (tenant_id, type, payload, correlation_id)
  values (
    creative_tenant_id,
    'publish.requested',
    jsonb_build_object('creativeId', target_creative_id),
    gen_random_uuid()
  );
end;
$$;

revoke all on function public.request_creative_publish(uuid) from public;
grant execute on function public.request_creative_publish(uuid) to authenticated;
