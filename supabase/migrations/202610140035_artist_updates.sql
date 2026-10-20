-- Apply after 034. Artist conversations inherit current assignments; no private DMs.
begin;
create table public.artist_updates(
 id bigint generated always as identity primary key,
 workspace_id uuid not null references public.workspaces(id) on delete cascade,
 artist_id uuid not null references public.artists(record_id) on delete cascade,
 actor_id uuid references auth.users(id) on delete set null,
 request_id uuid,kind text not null check(kind in ('message','task','release')),
 body text not null check(length(body) between 1 and 4000),mentions uuid[] not null default '{}',
 record_id uuid,previous_date date,new_date date,created_at timestamptz not null default now(),
 unique(workspace_id,actor_id,request_id)
);
create index artist_updates_feed on public.artist_updates(workspace_id,artist_id,id desc);
create table public.artist_update_preferences(
 workspace_id uuid not null references public.workspaces(id) on delete cascade,
 artist_id uuid not null references public.artists(record_id) on delete cascade,
 user_id uuid not null references auth.users(id) on delete cascade,
 seen_id bigint not null default 0,notifications text not null default 'all' check(notifications in ('all','mentions','muted')),
 primary key(workspace_id,artist_id,user_id)
);
alter table public.artist_updates enable row level security;
alter table public.artist_update_preferences enable row level security;
revoke all on public.artist_updates,public.artist_update_preferences from public,anon,authenticated;
grant select on public.artist_updates,public.artist_update_preferences to authenticated;
create policy artist_updates_read on public.artist_updates for select to authenticated using(public.can_access_artist(workspace_id,artist_id));
create policy artist_preferences_read on public.artist_update_preferences for select to authenticated using(user_id=auth.uid() and public.can_access_artist(workspace_id,artist_id));
create function public.artist_conversation(w uuid,a uuid,before_id bigint default null) returns jsonb language plpgsql security definer set search_path='' as $$
declare pref public.artist_update_preferences%rowtype;
begin
 if not public.can_access_artist(w,a) or not exists(select 1 from public.artists where workspace_id=w and record_id=a) then raise exception 'Artist access required' using errcode='42501';end if;
 select * into pref from public.artist_update_preferences where workspace_id=w and artist_id=a and user_id=auth.uid();
 return jsonb_build_object('can_post',public.workspace_role(w)<>'viewer','notifications',coalesce(pref.notifications,'all'),
 'unread',(select count(*) from public.artist_updates u where u.workspace_id=w and u.artist_id=a and u.id>coalesce(pref.seen_id,0) and u.actor_id is distinct from auth.uid() and coalesce(pref.notifications,'all')<>'muted' and (coalesce(pref.notifications,'all')='all' or auth.uid()=any(u.mentions))),
 'team',(select coalesce(jsonb_agg(jsonb_build_object('id',m.user_id,'name',coalesce(nullif(trim(p.full_name),''),'Team member'))),'[]') from public.workspace_members m left join public.profiles p on p.id=m.user_id where m.workspace_id=w and (m.role='owner' or exists(select 1 from public.artist_access aa where aa.workspace_id=w and aa.artist_id=a and aa.user_id=m.user_id))),
 'updates',(select coalesce(jsonb_agg(to_jsonb(items) order by items.id desc),'[]') from (select u.*,coalesce(nullif(trim(p.full_name),''),'Team member') actor_name from public.artist_updates u left join public.profiles p on p.id=u.actor_id where u.workspace_id=w and u.artist_id=a and (before_id is null or u.id<before_id) order by u.id desc limit 50) items));
end $$;
create function public.post_artist_update(w uuid,a uuid,request uuid,message text,mentioned uuid[]) returns bigint language plpgsql security definer set search_path='' as $$
declare result bigint;
begin
 if coalesce(public.workspace_role(w),'viewer')='viewer' or not public.can_access_artist(w,a) or not exists(select 1 from public.artists where workspace_id=w and record_id=a and archived_at is null) then raise exception 'Artist editor access required' using errcode='42501';end if;
 if request is null or message is null or length(trim(message)) not between 1 and 4000 or mentioned is null or cardinality(mentioned)>50 then raise exception 'Invalid message';end if;
 if exists(select 1 from unnest(mentioned) x where x is null or not exists(select 1 from public.workspace_members m where m.workspace_id=w and m.user_id=x and (m.role='owner' or exists(select 1 from public.artist_access aa where aa.workspace_id=w and aa.artist_id=a and aa.user_id=x)))) then raise exception 'Mention only the current artist team';end if;
 insert into public.artist_updates(workspace_id,artist_id,actor_id,request_id,kind,body,mentions) values(w,a,auth.uid(),request,'message',trim(message),mentioned) on conflict(workspace_id,actor_id,request_id) do nothing returning id into result;
 if result is null then
 select id into result from public.artist_updates where workspace_id=w and actor_id=auth.uid() and request_id=request and artist_id=a and body=trim(message) and mentions=mentioned;
 if result is null then raise exception 'Message request changed';end if;
 end if;
 return result;
end $$;
create function public.set_artist_update_preferences(w uuid,a uuid,seen bigint,mode text) returns void language plpgsql security definer set search_path='' as $$
begin
 if not public.can_access_artist(w,a) or not exists(select 1 from public.artists where workspace_id=w and record_id=a) then raise exception 'Artist access required' using errcode='42501';end if;
 if mode is null or mode not in ('all','mentions','muted') or seen is null or seen<0 or (seen<>0 and not exists(select 1 from public.artist_updates where workspace_id=w and artist_id=a and id=seen)) then raise exception 'Invalid preference';end if;
 insert into public.artist_update_preferences(workspace_id,artist_id,user_id,seen_id,notifications) values(w,a,auth.uid(),seen,mode)
 on conflict(workspace_id,artist_id,user_id) do update set seen_id=greatest(public.artist_update_preferences.seen_id,excluded.seen_id),notifications=excluded.notifications;
end $$;
create function public.record_artist_date_update() returns trigger language plpgsql security definer set search_path='' as $$
declare aid uuid;previous date;current_value date;k text;
begin
 k:=case when TG_TABLE_NAME='tasks' then 'task' else 'release' end;
 previous:=(to_jsonb(old)->>case when k='task' then 'due_date' else 'release_date' end)::date;
 current_value:=(to_jsonb(new)->>case when k='task' then 'due_date' else 'release_date' end)::date;
 if previous is not distinct from current_value then return new;end if;
 aid:=new.artist_id;
 if aid is null and k='task' then select artist_id into aid from public.releases where id=new.release_id and workspace_id=new.workspace_id;end if;
 if aid is not null then
 insert into public.artist_updates(workspace_id,artist_id,actor_id,kind,body,record_id,previous_date,new_date) values(new.workspace_id,aid,auth.uid(),k,new.title,new.id,previous,current_value);
 end if;
 return new;
end $$;
create trigger artist_task_date_update after update on public.tasks for each row execute function public.record_artist_date_update();
create trigger artist_release_date_update after update on public.releases for each row execute function public.record_artist_date_update();
revoke all on function public.record_artist_date_update() from public,anon,authenticated;
revoke all on function public.artist_conversation(uuid,uuid,bigint),public.post_artist_update(uuid,uuid,uuid,text,uuid[]),public.set_artist_update_preferences(uuid,uuid,bigint,text) from public,anon;
grant execute on function public.artist_conversation(uuid,uuid,bigint),public.post_artist_update(uuid,uuid,uuid,text,uuid[]),public.set_artist_update_preferences(uuid,uuid,bigint,text) to authenticated;
commit;
