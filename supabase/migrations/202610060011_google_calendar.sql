-- Apply once after 010. Private Calendar credentials and serialized manual sync.
begin;
create table public.calendar_connections (
 workspace_id uuid not null references public.workspaces(id) on delete cascade,
 user_id uuid not null references auth.users(id) on delete cascade,
 connection_id uuid not null,
 email text not null check(char_length(email) between 3 and 254),
 encrypted_refresh_token text,
 calendar_id text,
 creation_started boolean not null default false,
 lease_id uuid,
 lease_until timestamptz,
 primary key(workspace_id,user_id)
);
alter table public.calendar_connections enable row level security;
revoke all on public.calendar_connections from public,anon,authenticated;
grant select,insert,update on public.calendar_connections to authenticated;
create policy calendar_owner on public.calendar_connections for all to authenticated
 using(user_id=(select auth.uid()) and workspace_id in(select workspace_id from public.workspace_members where user_id=(select auth.uid())))
 with check(user_id=(select auth.uid()) and workspace_id in(select workspace_id from public.workspace_members where user_id=(select auth.uid())));
create function public.claim_calendar_sync(p_workspace uuid,p_connection uuid,p_lease uuid) returns boolean
language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null or not exists(select 1 from public.workspace_members where workspace_id=p_workspace and user_id=auth.uid()) then raise exception 'Access denied' using errcode='42501'; end if;
 if p_lease is null then return false; end if;
 update public.calendar_connections set lease_id=p_lease,lease_until=now()+interval '30 minutes'
 where workspace_id=p_workspace and user_id=auth.uid() and connection_id=p_connection and encrypted_refresh_token is not null and (lease_until is null or lease_until<now());
 return found;
end $$;
revoke all on function public.claim_calendar_sync(uuid,uuid,uuid) from public,anon;
grant execute on function public.claim_calendar_sync(uuid,uuid,uuid) to authenticated;
commit;
