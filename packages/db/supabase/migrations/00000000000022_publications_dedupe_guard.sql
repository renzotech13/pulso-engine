-- Real bug found in production: the same Mohrroce creative got published
-- twice to Facebook and twice to Instagram within under a second of each
-- other. Root cause is a check-then-act race in
-- runPublishAgentForCreative — getHandledPublication only looks at rows
-- already 'published'/'scheduled', so two concurrent runs for the same
-- creative (the publish worker runs with concurrency: 2, and a full-auto
-- creative can legitimately get more than one publish.requested event fired
-- at it — the eager fire in creative.ts, publish.tick, and render-tick's
-- self-heal path can all reach the same creative) both pass the check
-- before either has written its own row, and both go on to call Meta's API
-- for real.
--
-- A retry after a genuine failure still needs to insert a fresh row (see
-- e.g. the real token-expiry saga earlier this session — same creative,
-- several 'failed' rows before the one that finally worked), so this can't
-- be a flat unique constraint on (creative_id, platform). It only needs to
-- block a SECOND row from existing while a first one is still pending,
-- scheduled, or already published — exactly the states that mean "don't
-- call Meta again for this platform".
create unique index publications_active_unique_idx
  on public.publications (creative_id, platform)
  where status in ('pending', 'scheduled', 'published');
