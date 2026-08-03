-- Facebook soporta programación real vía Graph API (published=false +
-- scheduled_publish_time) — el post queda visible en el Planner de Meta
-- Business Suite antes de publicarse de verdad. Instagram no tiene este
-- mecanismo para apps de terceros (confirmado en la referencia oficial de
-- /media y /media_publish — no existe el parámetro), así que 'scheduled'
-- solo se usa para Facebook; Instagram sigue yendo directo a 'published' el
-- día que corresponde.

alter table public.publications
  drop constraint publications_status_check;

alter table public.publications
  add constraint publications_status_check
  check (status in ('pending', 'scheduled', 'published', 'failed'));
