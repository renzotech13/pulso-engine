-- PostgREST has no way to express `SELECT ... FOR UPDATE SKIP LOCKED` from
-- the client, so the atomic claim step lives in a SECURITY DEFINER function
-- that the dispatcher calls via `.rpc()`. Multiple dispatcher processes can
-- call this concurrently without double-claiming the same event.
create or replace function public.claim_pending_events(batch_size int default 100)
returns setof public.events
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
  update public.events
  set status = 'dispatched', dispatched_at = now(), attempts = attempts + 1
  where id in (
    select id from public.events
    where status = 'pending'
    order by created_at
    limit batch_size
    for update skip locked
  )
  returning *;
end;
$$;

revoke all on function public.claim_pending_events(int) from public;
grant execute on function public.claim_pending_events(int) to service_role;
