-- Fase 2: agente Creative. Ningún cambio de schema — brand_kits,
-- render_templates, creatives, content_calendar.creative_id ya existen
-- desde la migración anterior. Solo falta el disparador: aprobar un slot
-- del calendario debe poder emitir un evento, y un usuario normal no tiene
-- política de insert sobre `events` (mismo motivo que
-- request_calendar_regeneration).

-- ---------------------------------------------------------------------------
-- request_creative_generation — el dropdown de status en /calendar dispara
-- esto cuando un slot pasa a 'approved'. El agente Creative decide en su
-- propio código si ya existe un creative para este slot (idempotencia vive
-- ahí, no acá).
-- ---------------------------------------------------------------------------
create or replace function public.request_creative_generation(target_calendar_slot_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  slot_tenant_id uuid;
begin
  select tenant_id into slot_tenant_id
  from public.content_calendar
  where id = target_calendar_slot_id;

  if slot_tenant_id is null then
    raise exception 'calendar slot not found';
  end if;

  if private.user_role_for_tenant(slot_tenant_id) not in ('owner', 'admin') then
    raise exception 'not a member of this tenant';
  end if;

  insert into public.events (tenant_id, type, payload, correlation_id)
  values (
    slot_tenant_id,
    'creative.requested',
    jsonb_build_object('calendarSlotId', target_calendar_slot_id),
    gen_random_uuid()
  );
end;
$$;

revoke all on function public.request_creative_generation(uuid) from public;
grant execute on function public.request_creative_generation(uuid) to authenticated;
