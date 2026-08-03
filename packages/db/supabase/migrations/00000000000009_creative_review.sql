-- Fase 2: cierre del loop de revisión de creatives. Falta la política de
-- delete — hoy solo existen select/update — necesaria para "Regenerar"
-- (borrar el creative actual y dejar que el agente Creative genere uno
-- nuevo limpio para el mismo slot).

create policy creatives_delete on public.creatives
  for delete
  using (private.user_role_for_tenant(tenant_id) in ('owner', 'admin'));
