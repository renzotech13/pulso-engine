-- Fase 2: bucket para el logo del brand kit. Público por la misma razón que
-- product-media/creative-assets: es material que va a terminar compuesto
-- en piezas publicadas, no un documento privado.

insert into storage.buckets (id, name, public)
values ('brand-assets', 'brand-assets', true)
on conflict (id) do nothing;

create policy "tenant members can upload their brand assets"
  on storage.objects for insert
  with check (
    bucket_id = 'brand-assets'
    and (storage.foldername(name))[1]::uuid in (select private.user_tenant_ids())
  );

create policy "tenant members can delete their brand assets"
  on storage.objects for delete
  using (
    bucket_id = 'brand-assets'
    and (storage.foldername(name))[1]::uuid in (select private.user_tenant_ids())
  );
