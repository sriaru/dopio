-- Private assistant history and idempotent task commands. Existing task triggers
-- continue to enforce dates, versions, audit history and artist-team events.
begin;
create table public.assistant_conversations(
 id uuid primary key, workspace_id uuid not null references public.workspaces(id) on delete cascade,
 user_id uuid not null references auth.users(id) on delete cascade,
 access_role text not null,
 title text not null check(length(title) between 1 and 100),
 messages jsonb not null default '[]', artist_ids uuid[] not null default '{}',
 version integer not null default 1, updated_at timestamptz not null default now(),
 check(jsonb_typeof(messages)='array' and jsonb_array_length(messages)<=60 and octet_length(messages::text)<=300000)
);
alter table public.assistant_conversations enable row level security;
revoke all on public.assistant_conversations from public,anon,authenticated;
grant select on public.assistant_conversations to authenticated;
create function public.can_read_assistant_history(w uuid,ids uuid[]) returns boolean language sql stable security definer set search_path='' as $$
 select public.workspace_role(w) is not null and not exists(select 1 from unnest(ids) a where not public.can_access_artist(w,a) or not exists(select 1 from public.artists where workspace_id=w and record_id=a))
$$;
create policy own_assistant_history on public.assistant_conversations for select to authenticated using(user_id=auth.uid() and access_role=public.workspace_role(workspace_id) and public.can_read_assistant_history(workspace_id,artist_ids));
create function public.save_assistant_conversation(w uuid,i uuid,v integer,t text,m jsonb,artists uuid[]) returns integer language plpgsql security definer set search_path='' as $$
declare c public.assistant_conversations%rowtype;begin
 if auth.uid() is null or artists is null or not public.can_read_assistant_history(w,artists) then raise exception 'Workspace or artist access changed' using errcode='42501';end if;
 if i is null or v is null or t is null or length(trim(t)) not between 1 and 100 or m is null then raise exception 'Invalid conversation';end if;
 perform pg_advisory_xact_lock(hashtextextended(i::text,38));
 select * into c from public.assistant_conversations where id=i for update;
 if found then
 if c.workspace_id<>w or c.user_id<>auth.uid() or c.access_role<>public.workspace_role(w) or not public.can_read_assistant_history(w,c.artist_ids) then raise exception 'Conversation unavailable' using errcode='42501';end if;
 if c.messages=m and c.title=t then return c.version;end if;
 if c.version<>v then raise exception 'Conversation changed. Reload.' using errcode='40001';end if;
 update public.assistant_conversations set messages=m,title=t,artist_ids=array(select distinct unnest(c.artist_ids||artists)),version=c.version+1,updated_at=now() where id=i;
 return c.version+1;
 end if;
 if v<>0 then raise exception 'Conversation unavailable';end if;
 insert into public.assistant_conversations(id,workspace_id,user_id,access_role,title,messages,artist_ids) values(i,w,auth.uid(),public.workspace_role(w),t,m,artists);
 return 1;
end $$;
create table public.assistant_action_receipts(
 request_id uuid primary key,workspace_id uuid not null references public.workspaces(id) on delete cascade,
 user_id uuid not null references auth.users(id),payload jsonb not null,record_kind text not null check(record_kind in('task','artist','release')),record_id uuid not null,created_at timestamptz not null default now()
);
alter table public.assistant_action_receipts enable row level security;
revoke all on public.assistant_action_receipts from public,anon,authenticated;
grant select on public.assistant_action_receipts to authenticated;
create policy own_assistant_requests on public.assistant_action_receipts for select to authenticated using(user_id=auth.uid() and (case when record_kind='task' then public.can_access_task(workspace_id,record_id) when record_kind='artist' then public.can_access_artist(workspace_id,record_id) else exists(select 1 from public.releases where id=record_id and workspace_id=assistant_action_receipts.workspace_id and public.can_access_artist(workspace_id,artist_id)) end));
create function public.execute_assistant_task(w uuid,request uuid,p jsonb) returns uuid language plpgsql security definer set search_path='' as $$
declare saved public.assistant_action_receipts%rowtype;t public.tasks%rowtype;r public.releases%rowtype;aid uuid;rid uuid;tid uuid;d date;begin
 if auth.uid() is null or coalesce(public.workspace_role(w),'viewer') not in('owner','manager') then raise exception 'Manager required' using errcode='42501';end if;
 if request is null or p is null or p->>'kind' not in('create_task','update_task') or p->>'kind' is null then raise exception 'Invalid action';end if;
 perform pg_advisory_xact_lock(hashtextextended(request::text,38));
 select * into saved from public.assistant_action_receipts where request_id=request;
 if found then
 if saved.workspace_id<>w or saved.user_id<>auth.uid() or saved.payload is distinct from p or not public.can_access_task(w,saved.record_id) then raise exception 'Request unavailable' using errcode='42501';end if;
 return saved.record_id;
 end if;
 if p->>'kind'='update_task' then
 tid:=(p->>'target_id')::uuid;
 if not public.can_access_task(w,tid) then raise exception 'Task access required' using errcode='42501';end if;
 select r0.* into r from public.releases r0 join public.tasks t0 on t0.release_id=r0.id and t0.workspace_id=r0.workspace_id where t0.id=tid and t0.workspace_id=w for update of r0;
 select * into t from public.tasks where id=tid and workspace_id=w for update;
 if not found or t.archived_at is not null or t.version is distinct from (p->>'version')::integer then raise exception 'Task changed. Review again.' using errcode='40001';end if;
 aid:=t.artist_id;rid:=t.release_id;
 else
 aid:=(p->>'artist_id')::uuid;rid:=(p->>'release_id')::uuid;
 if rid is not null then
 select * into r from public.releases where id=rid and workspace_id=w for update;
 if not found or r.artist_id is distinct from aid then raise exception 'Project unavailable';end if;
 end if;
 end if;
 if aid is null or not public.can_access_artist(w,aid) or not exists(select 1 from public.artists where workspace_id=w and record_id=aid and archived_at is null) or r.archived_at is not null then raise exception 'Artist unavailable' using errcode='42501';end if;
 perform 1 from public.artists where workspace_id=w and record_id=aid for share;
 if (select version from public.artists where workspace_id=w and record_id=aid) is distinct from (p->>'artist_version')::integer or (r.id is not null and r.version is distinct from (p->>'release_version')::integer) then raise exception 'Artist or project changed. Review again.' using errcode='40001';end if;
 if p->>'title' is null or length(trim(p->>'title')) not between 1 and 150 or coalesce(p->>'notes','') is null or length(coalesce(p->>'notes',''))>5000 or coalesce(p->>'status','') not in('Pending','In progress','Complete') then raise exception 'Invalid task values';end if;
 if p->>'date' is not null and p->>'date' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then raise exception 'Use a full ISO deadline';end if;
 d:=(p->>'date')::date;
 if d is not null and (d not between '1900-01-01'::date and '2199-12-31'::date or (r.format in('Single','EP','Album') and p->>'status'<>'Complete' and d>r.release_date)) then raise exception 'Deadline conflicts with release';end if;
 if p->>'kind'='create_task' then
 insert into public.tasks(workspace_id,artist_id,release_id,title,due_date,status,notes) values(w,aid,rid,trim(p->>'title'),d,p->>'status',coalesce(p->>'notes','')) returning id into tid;
 else
 update public.tasks set title=trim(p->>'title'),due_date=d,status=p->>'status',notes=coalesce(p->>'notes','') where id=tid and workspace_id=w;
 end if;
 insert into public.assistant_action_receipts values(request,w,auth.uid(),p,'task',tid,now());return tid;
end $$;
create function public.execute_assistant_record(w uuid,request uuid,p jsonb) returns uuid language plpgsql security definer set search_path='' as $$
declare saved public.assistant_action_receipts%rowtype; a public.artists%rowtype;r public.releases%rowtype;b public.artist_briefs%rowtype; target uuid;k text;begin
 if auth.uid() is null or coalesce(public.workspace_role(w),'viewer') not in('owner','manager') then raise exception 'Manager required' using errcode='42501';end if;
 k:=p->>'kind';target:=(p->>'target_id')::uuid;
 if request is null or k is null or k not in('create_artist','update_artist','update_brief','update_project_notes') then raise exception 'Invalid action';end if;
 perform pg_advisory_xact_lock(hashtextextended(request::text,38));
 select * into saved from public.assistant_action_receipts where request_id=request;
 if found then
 if saved.workspace_id<>w or saved.user_id<>auth.uid() or saved.payload is distinct from p then raise exception 'Request unavailable' using errcode='42501';end if;
 if saved.record_kind='artist' and (not public.can_access_artist(w,saved.record_id) or not exists(select 1 from public.artists where workspace_id=w and record_id=saved.record_id)) or saved.record_kind='release' and not exists(select 1 from public.releases where workspace_id=w and id=saved.record_id and public.can_access_artist(w,artist_id)) then raise exception 'Access changed' using errcode='42501';end if;
 return saved.record_id;
 end if;
 if k='create_artist' then
 if p->>'title' is null or length(trim(p->>'title')) not between 1 and 100 then raise exception 'Invalid artist';end if;
 insert into public.artists(workspace_id,name) values(w,trim(p->>'title')) returning record_id into target;
 elsif k='update_project_notes' then
 select * into r from public.releases where workspace_id=w and id=target for update;
 if not found or r.archived_at is not null or not public.can_access_artist(w,r.artist_id) or not exists(select 1 from public.artists where workspace_id=w and record_id=r.artist_id and archived_at is null) then raise exception 'Project access required' using errcode='42501';end if;
 if r.version is distinct from (p->>'version')::integer then raise exception 'Project changed' using errcode='40001';end if;
 if p->>'notes' is null or length(p->>'notes')>5000 then raise exception 'Invalid notes';end if;
 update public.releases set notes=p->>'notes' where id=target and workspace_id=w;
 else
 select * into a from public.artists where workspace_id=w and record_id=target for update;
 if not found or a.archived_at is not null or not public.can_access_artist(w,target) then raise exception 'Artist access required' using errcode='42501';end if;
 if k='update_brief' then
 select * into b from public.artist_briefs where workspace_id=w and artist_id=target;
 if p->>'notes' is null or length(p->>'notes')>5000 then raise exception 'Invalid brief';end if;
 perform public.save_artist_brief(w,target,(p->>'version')::integer,coalesce(b.contacts,''),p->>'notes',coalesce(b.preferences,''));
 else
 if a.version is distinct from (p->>'version')::integer then raise exception 'Artist changed' using errcode='40001';end if;
 if p->>'title' is null or length(trim(p->>'title')) not between 1 and 100 or coalesce(p->>'status','') not in('Active','On Hold') then raise exception 'Invalid artist';end if;
 update public.artists set name=trim(p->>'title'),status=p->>'status' where record_id=target and workspace_id=w;
 end if;
 end if;
 insert into public.assistant_action_receipts values(request,w,auth.uid(),p,case when k='update_project_notes' then 'release' else 'artist' end,target,now());return target;
end $$;
revoke all on function public.execute_assistant_record(uuid,uuid,jsonb) from public,anon;
grant execute on function public.execute_assistant_record(uuid,uuid,jsonb) to authenticated;
revoke all on function public.can_read_assistant_history(uuid,uuid[]),public.save_assistant_conversation(uuid,uuid,integer,text,jsonb,uuid[]),public.execute_assistant_task(uuid,uuid,jsonb) from public,anon;
grant execute on function public.can_read_assistant_history(uuid,uuid[]),public.save_assistant_conversation(uuid,uuid,integer,text,jsonb,uuid[]),public.execute_assistant_task(uuid,uuid,jsonb) to authenticated;
commit;
