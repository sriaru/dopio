-- Read-only. No tokens, credentials or email contents are returned.
select w.name as workspace, p.full_name as member,
 c.calendar_id is not null as has_google_calendar,
 c.creation_started as creation_was_attempted,
 coalesce(c.lease_until>now(),false) as sync_in_progress,
 (select count(*) from public.google_calendar_runs r where r.workspace_id=c.workspace_id and r.actor_id=c.user_id) as sync_attempts,
 (select coalesce(jsonb_agg(jsonb_build_object('status',r.status,'events',r.confirmed_events,'removals',r.confirmed_removals,'at',r.created_at)),'[]'::jsonb)
 from public.google_calendar_runs r where r.workspace_id=c.workspace_id and r.actor_id=c.user_id) as sync_results
from public.calendar_connections c
join public.workspaces w on w.id=c.workspace_id
left join public.profiles p on p.id=c.user_id
where c.workspace_id='715ceb2b-a82d-4e32-8bea-95dd2e7cb057';
