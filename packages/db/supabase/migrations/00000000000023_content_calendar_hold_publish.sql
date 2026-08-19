-- "No publicar" toggle on a calendar day: blocks only the AUTOMATIC publish
-- paths (creative.ts's eager fire, publish.tick, render.tick's self-heal) —
-- content still generates normally, and a human explicitly clicking
-- "Publicar" still works (that's a deliberate override, checked in
-- runPublishAgentForCreative via a parameter, not this flag alone).
alter table public.content_calendar
  add column hold_publish boolean not null default false;
