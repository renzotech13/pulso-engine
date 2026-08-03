-- "photo-frame" render templates: a tenant-uploaded overlay (transparent PNG)
-- composited on top of a cover-fit photo, at a tenant-chosen canvas size.
-- Nullable and unused by every other component_ref — existing templates are
-- untouched.
alter table public.render_templates
  add column if not exists frame_image_url text,
  add column if not exists canvas_width int,
  add column if not exists canvas_height int;

-- render_templates deliberately has no insert/update policy for
-- `authenticated` (template writes go through service_role / an approval
-- queue by original design — see 00000000000006). photo-frame is the one
-- carve-out: it's pure data (an uploaded image + a canvas size), not code,
-- so a tenant owner/admin configuring their own frame is safe to allow
-- directly, scoped tightly to their own tenant_id and only this component_ref.
create policy render_templates_photo_frame_insert on public.render_templates
  for insert
  with check (
    component_ref = 'photo-frame'
    and tenant_id is not null
    and tenant_id in (select private.user_tenant_ids())
  );

create policy render_templates_photo_frame_update on public.render_templates
  for update
  using (
    component_ref = 'photo-frame'
    and tenant_id is not null
    and tenant_id in (select private.user_tenant_ids())
  )
  with check (
    component_ref = 'photo-frame'
    and tenant_id is not null
    and tenant_id in (select private.user_tenant_ids())
  );
