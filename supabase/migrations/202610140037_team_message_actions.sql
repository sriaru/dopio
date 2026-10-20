-- Apply after 036. Reuse artist_updates and existing email approval execution.
begin;
-- Explicit per-message receipts avoid skipping a late-committing lower sequence ID.
create table public.artist_update_reads(
 workspace_id uuid not null references public.workspaces(id) on delete cascade,
 artist_id uuid not null references public.artists(record_id) on delete cascade,
 user_id uuid not null references auth.users(id) on delete cascade,
 update_id bigint not null references public.artist_updates(id) on delete cascade,
 primary key(user_id,update_id)
);
alter table public.artist_update_reads enable row level security;
revoke all on public.artist_update_reads from public,anon,authenticated;
grant select on public.artist_update_reads to authenticated;
create policy own_team_reads on public.artist_update_reads for select to authenticated using(user_id=auth.uid() and public.can_access_artist(workspace_id,artist_id));
create function public.mark_artist_messages_read(w uuid,a uuid,ids bigint[]) returns void language plpgsql security definer set search_path='' as $$
begin
 if not public.can_access_artist(w,a) or not exists(select 1 from public.artists where workspace_id=w and record_id=a) then raise exception 'Artist access required' using errcode='42501';end if;
 if ids is null or cardinality(ids)>100 then raise exception 'Read at most 100 displayed messages';end if;
 insert into public.artist_update_reads(workspace_id,artist_id,user_id,update_id)
 select w,a,auth.uid(),id from public.artist_updates where workspace_id=w and artist_id=a and id=any(ids) on conflict do nothing;
end $$;
create function public.artist_message_unread(w uuid,a uuid,i bigint) returns boolean language sql stable security definer set search_path='' as $$
 select public.can_access_artist(w,a) and exists(select 1 from public.artist_updates u
 where u.workspace_id=w and u.artist_id=a and u.id=i and u.actor_id is distinct from auth.uid()
 and u.id>coalesce((select seen_id from public.artist_update_preferences where workspace_id=w and artist_id=a and user_id=auth.uid()),0)
 and coalesce((select notifications from public.artist_update_preferences where workspace_id=w and artist_id=a and user_id=auth.uid()),'all')<>'muted'
 and (coalesce((select notifications from public.artist_update_preferences where workspace_id=w and artist_id=a and user_id=auth.uid()),'all')='all' or auth.uid()=any(u.mentions))
 and not exists(select 1 from public.artist_update_reads r where r.user_id=auth.uid() and r.update_id=u.id))
$$;
create function public.artist_team_overview(w uuid,skip integer default 0) returns jsonb language sql stable security definer set search_path='' as $$
 select coalesce(jsonb_agg(to_jsonb(x) order by (x.unread>0) desc,x.latest_at desc nulls last,x.name,x.record_id),'[]') from (
 select a.record_id,a.name,
 (select count(*) from public.artist_updates u where u.workspace_id=w and u.artist_id=a.record_id and public.artist_message_unread(w,a.record_id,u.id)) unread,
 (select (case when u.kind='message' then coalesce((select full_name from public.profiles where id=u.actor_id),'Team member') else 'Dopio' end)||': '||left(u.body,140) from public.artist_updates u where u.workspace_id=w and u.artist_id=a.record_id order by id desc limit 1) preview,
 (select u.created_at from public.artist_updates u where u.workspace_id=w and u.artist_id=a.record_id order by id desc limit 1) latest_at
 from public.artists a where a.workspace_id=w and a.archived_at is null and public.can_access_artist(w,a.record_id)
 order by a.name,a.record_id limit 1000 offset greatest(skip,0)) x
$$;
create function public.artist_ai_messages(w uuid,a uuid,unread_only boolean) returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if not public.can_access_artist(w,a) or not exists(select 1 from public.artists where workspace_id=w and record_id=a and archived_at is null) then raise exception 'Artist access required' using errcode='42501';end if;
 return (select coalesce(jsonb_agg(to_jsonb(x) order by id),'[]') from
 (select u.id,u.body,u.kind,u.created_at,coalesce(p.full_name,'Team member') actor_name
 from public.artist_updates u left join public.profiles p on p.id=u.actor_id
 where u.workspace_id=w and u.artist_id=a and (not unread_only or public.artist_message_unread(w,a,u.id)) order by u.id desc limit 101) x);
end $$;
-- Add unread IDs to the existing conversation payload, retaining its access checks.
alter function public.artist_conversation(uuid,uuid,bigint) rename to private37_artist_conversation;
revoke all on function public.private37_artist_conversation(uuid,uuid,bigint) from public,anon,authenticated;
create function public.artist_conversation(w uuid,a uuid,before_id bigint default null) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb;begin
 result:=public.private37_artist_conversation(w,a,before_id);
 return result||jsonb_build_object('unread',(select count(*) from public.artist_updates where workspace_id=w and artist_id=a and public.artist_message_unread(w,a,id)),
 'unread_ids',(select coalesce(jsonb_agg((v->>'id')::bigint),'[]') from jsonb_array_elements(result->'updates') v where public.artist_message_unread(w,a,(v->>'id')::bigint)));
end $$;
-- A chat source is a provenance record in the existing approval inbox, never a
-- fabricated email. Its visibility follows the original artist conversation.
alter table public.inbox_messages add column team_update_id bigint references public.artist_updates(id);
alter table public.inbox_messages drop constraint inbox_messages_source_check;
alter table public.inbox_messages add constraint inbox_messages_source_check check(source in('sample','manual','ai','gmail','team'));
alter table public.inbox_messages add constraint team_source_required check((source='team')=(team_update_id is not null));
create or replace function public.can_access_message(w uuid,m uuid) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.inbox_messages i where i.workspace_id=w and i.id=m and
 case when i.source='team' then exists(select 1 from public.artist_updates u where u.id=i.team_update_id and u.workspace_id=w and public.can_access_artist(w,u.artist_id))
 else public.workspace_role(w)='owner' or (public.workspace_role(w) is not null and i.imported_by=auth.uid()) end)
$$;
-- Existing evidence/context capture validates chat provenance and selected target.
alter function public.capture_email_review_context() rename to private37_capture_email_review_context;
create function public.capture_email_review_context() returns trigger language plpgsql security definer set search_path='' as $$
declare m public.inbox_messages%rowtype;u public.artist_updates%rowtype;aid uuid;k text;target uuid;proposed date;
begin
 select * into m from public.inbox_messages where workspace_id=new.workspace_id and id=new.message_id for update;
 k:=case when TG_TABLE_NAME='deadline_proposals' then 'task' else 'release' end;
 target:=case when k='task' then (to_jsonb(new)->>'task_id')::uuid else (to_jsonb(new)->>'release_id')::uuid end;
 proposed:=case when k='task' then (to_jsonb(new)->>'proposed_due_date')::date else (to_jsonb(new)->>'proposed_date')::date end;
 if m.id is null or new.evidence is null or length(trim(new.evidence))=0 or position(new.evidence in m.body)=0 then raise exception 'Exact source quote required';end if;
 if m.source='team' then
 select * into u from public.artist_updates where id=m.team_update_id and workspace_id=m.workspace_id;
 if k='task' then select artist_id into aid from public.tasks where workspace_id=m.workspace_id and id=target;
 else select artist_id into aid from public.releases where workspace_id=m.workspace_id and id=target;end if;
 if u.kind<>'message' or u.body is distinct from m.body or aid is distinct from u.artist_id or not public.can_access_artist(m.workspace_id,u.artist_id) then raise exception 'Chat source does not match target artist' using errcode='42501';end if;
 else
 if not public.email_quote_has_date(new.evidence,proposed) then raise exception 'The source quote must contain the proposed full date';end if;
 end if;
 if exists(select 1 from public.deadline_proposals where workspace_id=m.workspace_id and message_id=m.id)
 or exists(select 1 from public.release_email_proposals where workspace_id=m.workspace_id and message_id=m.id) then raise exception 'Source already reviewed';end if;
 new.reviewed_context:=public.email_review_context(m.workspace_id,k,target);return new;
end $$;
-- Rebind triggers after renaming their old implementation.
drop trigger capture_email_context on public.deadline_proposals;
drop trigger capture_email_context on public.release_email_proposals;
create trigger capture_email_context before insert on public.deadline_proposals for each row execute function public.capture_email_review_context();
create trigger capture_email_context before insert on public.release_email_proposals for each row execute function public.capture_email_review_context();
create function public.review_artist_message(w uuid,a uuid,source_id bigint,k text,target uuid,expected integer,proposed date,quote text) returns uuid language plpgsql security definer set search_path='' as $$
declare u public.artist_updates%rowtype;t public.tasks%rowtype;r public.releases%rowtype;m uuid;saved uuid;fp text;artist_name text;begin
 if coalesce(public.workspace_role(w),'viewer') not in('owner','manager') or not public.can_access_artist(w,a) then raise exception 'Manager access required' using errcode='42501';end if;
 select * into u from public.artist_updates where workspace_id=w and artist_id=a and id=source_id and kind='message';
 if not found or k not in('task','release') or k is null or proposed is null or quote is null or length(trim(quote)) not between 1 and 2000 or position(quote in u.body)=0 then raise exception 'Invalid reviewed source';end if;
 select name into artist_name from public.artists where workspace_id=w and record_id=a and archived_at is null;
 if artist_name is null then raise exception 'Artist unavailable';end if;
 fp:='team:'||source_id||':'||k||':'||target||':'||expected||':'||proposed;
 perform pg_advisory_xact_lock(hashtextextended(w::text||fp,37));
 select id into m from public.inbox_messages where workspace_id=w and fingerprint=fp;
 if found then
 if k='task' then select id into saved from public.deadline_proposals where message_id=m;
 else select id into saved from public.release_email_proposals where message_id=m;end if;
 if saved is not null then return saved;end if;
 end if;
 if k='task' then
 select * into t from public.tasks where workspace_id=w and id=target and artist_id=a for update;
 if not found or t.version is distinct from expected or t.archived_at is not null or t.status='Complete' then raise exception 'Task changed. Review again.' using errcode='40001';end if;
 else
 select * into r from public.releases where workspace_id=w and id=target and artist_id=a for update;
 if not found or r.version is distinct from expected or r.archived_at is not null then raise exception 'Project changed. Review again.' using errcode='40001';end if;
 end if;
 insert into public.inbox_messages(workspace_id,source,sender,subject,body,fingerprint,analysis_status,analysis_note,team_update_id)
 values(w,'team',coalesce((select full_name from public.profiles where id=u.actor_id),'Team member'),'Team chat review: '||left(artist_name,150),u.body,fp,'proposal','The manager selected the saved record and confirmed the full proposed date from a team message.',source_id) returning id into m;
 if k='task' then
 insert into public.deadline_proposals(workspace_id,message_id,task_id,task_title,artist_name,release_title,previous_due_date,proposed_due_date,expected_version,evidence)
 values(w,m,t.id,t.title,artist_name,(select title from public.releases where id=t.release_id),t.due_date,proposed,t.version,quote) returning id into saved;
 else
 saved:=public.propose_email_release(w,m,r.id,r.version,proposed,quote);
 end if;
 return saved;
end $$;
-- System events reveal only a target title/date or team-member identity, not
-- private email evidence or external contact information.
alter table public.artist_updates drop constraint artist_updates_kind_check;
alter table public.artist_updates add constraint artist_updates_kind_check check(kind in('message','task','release','assignment','approval'));
alter table public.artist_updates add column event_key text unique;
create function public.record_artist_team_event() returns trigger language plpgsql security definer set search_path='' as $$
declare aid uuid;rid uuid;k text;title text;event text;begin
 if TG_TABLE_NAME='artist_access' then
 aid:=case when TG_OP='DELETE' then old.artist_id else new.artist_id end;
 if not exists(select 1 from public.artists a join public.workspaces w on w.id=a.workspace_id where a.record_id=aid) then return null;end if;
 insert into public.artist_updates(workspace_id,artist_id,actor_id,kind,body)
 select case when TG_OP='DELETE' then old.workspace_id else new.workspace_id end,aid,auth.uid(),'assignment',
 coalesce(p.full_name,'Team member')||case when TG_OP='DELETE' then ' was removed from this artist team.' else ' was assigned to this artist team and its tasks.' end
 from public.profiles p where p.id=case when TG_OP='DELETE' then old.user_id else new.user_id end;
 return null;
 end if;
 k:=case when TG_TABLE_NAME='deadline_proposals' then 'task' else 'release' end;
 rid:=case when k='task' then (to_jsonb(new)->>'task_id')::uuid else (to_jsonb(new)->>'release_id')::uuid end;
 if k='task' then select artist_id,t.title into aid,title from public.tasks t where workspace_id=new.workspace_id and id=rid;
 else select artist_id,r.title into aid,title from public.releases r where workspace_id=new.workspace_id and id=rid;end if;
 event:='approval:'||TG_TABLE_NAME||':'||new.id;
 if aid is not null then insert into public.artist_updates(workspace_id,artist_id,actor_id,kind,body,record_id,event_key)
 values(new.workspace_id,aid,auth.uid(),'approval','Date change awaiting manager review: '||title,new.id,event) on conflict(event_key) do nothing;end if;
 return null;
end $$;
create trigger artist_team_assignment after insert or delete on public.artist_access for each row execute function public.record_artist_team_event();
create trigger task_review_team_notice after insert on public.deadline_proposals for each row execute function public.record_artist_team_event();
create trigger release_review_team_notice after insert on public.release_email_proposals for each row execute function public.record_artist_team_event();
revoke all on function public.mark_artist_messages_read(uuid,uuid,bigint[]),public.artist_message_unread(uuid,uuid,bigint),public.artist_team_overview(uuid,integer),public.artist_ai_messages(uuid,uuid,boolean),public.artist_conversation(uuid,uuid,bigint),public.review_artist_message(uuid,uuid,bigint,text,uuid,integer,date,text) from public,anon;
grant execute on function public.mark_artist_messages_read(uuid,uuid,bigint[]),public.artist_message_unread(uuid,uuid,bigint),public.artist_team_overview(uuid,integer),public.artist_ai_messages(uuid,uuid,boolean),public.artist_conversation(uuid,uuid,bigint),public.review_artist_message(uuid,uuid,bigint,text,uuid,integer,date,text) to authenticated;
revoke all on function public.capture_email_review_context(),public.private37_capture_email_review_context(),public.record_artist_team_event() from public,anon,authenticated;
do $$ begin if exists(select 1 from pg_publication where pubname='supabase_realtime') then alter publication supabase_realtime add table public.artist_update_reads;end if;end $$;
-- Keep decision receipts accurate now that committed date changes post to chat.
do $$ declare definition text;begin
 select pg_get_functiondef('public.decide_email_release(uuid,uuid,boolean)'::regprocedure) into definition;
 execute replace(definition,'Calendar sync and team messages require separate review; neither has been executed by this approval.','A saved date change appears in artist team chat. No emails sent or Calendar events changed.');
end $$;
commit;
