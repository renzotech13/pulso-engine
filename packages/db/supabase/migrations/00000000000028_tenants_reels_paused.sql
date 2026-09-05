-- Real request: AZ Estudio Contable's reels have open bugs, and the ask is
-- to stop generating them entirely "hasta nuevo aviso" — not just for new
-- Planner proposals, but for slots already sitting in the calendar as
-- approved reels weeks out. Per-tenant so this doesn't affect any tenant
-- that isn't having reel problems right now.
alter table public.tenants
  add column reels_paused boolean not null default false;
