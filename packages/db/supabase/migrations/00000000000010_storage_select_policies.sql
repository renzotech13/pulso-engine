-- Fix: none of the tenant-media buckets (product-media, creative-assets,
-- brand-assets) ever got a select policy on storage.objects — the earlier
-- reasoning was "the bucket is already public, no select policy needed",
-- which is true for the public *read* path (it serves raw files without
-- consulting storage.objects RLS at all), but the Storage API's authenticated
-- operations — delete, list — first resolve which rows match internally,
-- and that resolution IS gated by RLS. Without a select policy, that lookup
-- silently matches zero rows: `regenerateCreativeAction`'s cleanup delete
-- was discovered to leave orphaned assets behind for exactly this reason.

create policy "tenant members can list their product media"
  on storage.objects for select
  using (
    bucket_id = 'product-media'
    and (storage.foldername(name))[1]::uuid in (select private.user_tenant_ids())
  );

create policy "tenant members can list their creative assets"
  on storage.objects for select
  using (
    bucket_id = 'creative-assets'
    and (storage.foldername(name))[1]::uuid in (select private.user_tenant_ids())
  );

create policy "tenant members can list their brand assets"
  on storage.objects for select
  using (
    bucket_id = 'brand-assets'
    and (storage.foldername(name))[1]::uuid in (select private.user_tenant_ids())
  );
