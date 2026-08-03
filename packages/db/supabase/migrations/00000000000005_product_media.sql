-- Fotos y videos de catálogo. El bucket es público a propósito: estas son
-- fotos de marketing que el propio Planner/Creative va a terminar
-- publicando en redes — no son documentos privados, así que no vale la
-- complejidad de URLs firmadas con expiración.

alter table public.products_services
  add column video_urls text[] not null default array[]::text[];

insert into storage.buckets (id, name, public)
values ('product-media', 'product-media', true)
on conflict (id) do nothing;

-- Convención de path: {tenant_id}/{archivo} — el primer segmento del path
-- es el tenant, igual que en el resto del modelo.
create policy "tenant members can upload their product media"
  on storage.objects for insert
  with check (
    bucket_id = 'product-media'
    and (storage.foldername(name))[1]::uuid in (select private.user_tenant_ids())
  );

create policy "tenant members can delete their product media"
  on storage.objects for delete
  using (
    bucket_id = 'product-media'
    and (storage.foldername(name))[1]::uuid in (select private.user_tenant_ids())
  );

-- Lectura pública (el bucket ya es público) — sin política de select
-- adicional, coherente con que estas imágenes van a terminar en redes.
