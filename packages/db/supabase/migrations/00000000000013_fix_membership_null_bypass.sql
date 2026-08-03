-- Bug de seguridad real: `if private.user_role_for_tenant(id) not in ('owner',
-- 'admin') then raise exception` falla abierto para cualquiera que NO sea
-- miembro del tenant en absoluto. `private.user_role_for_tenant` devuelve
-- NULL cuando no hay membership, y en Postgres `NULL not in (...)` evalúa a
-- NULL — que en un `IF` de PL/pgSQL se trata como FALSE, así que la
-- excepción nunca se dispara y el INSERT sigue de largo.
--
-- Confirmado con:
--   select (null::text not in ('owner','admin'));  -- devuelve NULL, no TRUE
--
-- Efecto real: cualquier usuario logueado (o incluso anon, según el rol que
-- pueda ejecutar la función) que conozca/adivine el tenant_id, calendar_slot_id
-- o creative_id de OTRO tenant podía disparar `calendar.plan.requested`,
-- `creative.requested`, o el peor caso — `publish.requested` contra la
-- página de Facebook/Instagram real conectada de ese otro tenant.
--
-- El caso 'viewer' (miembro real pero sin rol owner/admin) sí bloqueaba
-- correctamente — el hueco era específicamente "no soy miembro en absoluto".
--
-- Fix: coalesce a un string vacío antes de comparar, así la expresión
-- siempre resuelve a TRUE/FALSE, nunca a NULL.

create or replace function public.request_calendar_regeneration(target_tenant_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if coalesce(private.user_role_for_tenant(target_tenant_id), '') not in ('owner', 'admin') then
    raise exception 'not a member of this tenant';
  end if;

  insert into public.events (tenant_id, type, payload, correlation_id)
  values (target_tenant_id, 'calendar.plan.requested', '{}'::jsonb, gen_random_uuid());
end;
$$;

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

  if coalesce(private.user_role_for_tenant(slot_tenant_id), '') not in ('owner', 'admin') then
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

  if coalesce(private.user_role_for_tenant(creative_tenant_id), '') not in ('owner', 'admin') then
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
