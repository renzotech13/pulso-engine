-- tenants.generation_paused — stops the Creative agent from generating any
-- NEW image/copy for a tenant, without touching publishing: `status` is a
-- global kill switch (planner/render/publish/news ticks all skip a paused
-- tenant, which also stops publishing already-ready creatives), and
-- `social_paused` only gates auto-publish, not generation itself. Neither
-- fits "keep publishing what's already on the calendar, just stop making
-- new creatives" — this is that third, narrower switch, checked as the
-- final gate inside runCreativeAgentForSlot so it covers every trigger path
-- (planner auto-approve, manual approve, "Volver a planificar", and the
-- render-tick backfill) with one check.

alter table public.tenants
  add column generation_paused boolean not null default false;
