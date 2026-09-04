-- Carousels are the expensive slot type: Gemini gets called once PER SLIDE
-- (5 to 7 calls), sequentially, versus at most one call for a post/story/
-- reel. AZ Estudio Contable's Planner picks slot_type on its own judgment
-- with no cap, and now that its morning slot is a real daily cadence, that
-- judgment alone isn't a cost control.
--
-- NULL (the default) keeps every existing tenant exactly as they are today
-- — the Planner already free-picks slot_type per day, uncapped.
alter table public.tenants
  add column max_weekly_carousels smallint
    check (max_weekly_carousels >= 0);
