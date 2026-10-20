-- Living artist briefs. Apply once after 006.
begin;
create table public.artist_briefs (
 workspace_id uuid not null references public.workspaces(id) on delete cascade,
 artist_id uuid not null,
 contacts text not null default '' check(char_length(contacts)<=5000),
 release_context text not null default '' check(char_length(release_context)<=5000),
 preferences text not null default '' check(char_length(preferences)<=5000),
 version integer not null default 1,
 updated_at timestamptz not null default now(),
 primary key(workspace_id,artist_id),
 foreign key(workspace_id,artist_id) references public.artists(workspace_id,record_id) on delete cascade
);
alter table public.artist_briefs enable row level security;
revoke all on public.artist_briefs from public,anon,authenticated;
grant select on public.artist_briefs to authenticated;
create policy brief_member_read on public.artist_briefs for select to authenticated using(workspace_id in(select workspace_id from public.workspace_members where user_id=(select auth.uid())));
create function public.save_artist_brief(p_workspace uuid,p_artist uuid,p_version integer,p_contacts text,p_context text,p_preferences text)
returns integer language plpgsql security definer set search_path='' as $$
declare current_version integer; artist_name text; next_version integer;
begin
 if auth.uid() is null or not exists(select 1 from public.workspace_members where workspace_id=p_workspace and user_id=auth.uid()) then raise exception 'Access denied' using errcode='42501'; end if;
 select name into artist_name from public.artists where record_id=p_artist and workspace_id=p_workspace for update;
 if not found then raise exception 'Artist unavailable' using errcode='42501'; end if;
 select version into current_version from public.artist_briefs where workspace_id=p_workspace and artist_id=p_artist;
 if p_version is null or coalesce(current_version,0)<>p_version then raise exception 'Brief changed. Reload before saving.' using errcode='40001'; end if;
 next_version:=coalesce(current_version,0)+1;
 insert into public.artist_briefs(workspace_id,artist_id,contacts,release_context,preferences,version)
 values(p_workspace,p_artist,p_contacts,p_context,p_preferences,next_version)
 on conflict(workspace_id,artist_id) do update set contacts=excluded.contacts,release_context=excluded.release_context,preferences=excluded.preferences,version=next_version,updated_at=now();
 insert into public.workspace_activity(workspace_id,actor_id,entity_type,entity_id,action,title) values(p_workspace,auth.uid(),'artist',p_artist,'updated',artist_name||' — artist brief');
 return next_version;
end $$;
revoke all on function public.save_artist_brief(uuid,uuid,integer,text,text,text) from public,anon;
grant execute on function public.save_artist_brief(uuid,uuid,integer,text,text,text) to authenticated;
commit;
