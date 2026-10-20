-- Apply after 031. Reuse existing proposal tables and privacy wrappers.
-- Existing pending proposals require a new review because their context was not captured.
begin;
alter table public.deadline_proposals add column reviewed_context jsonb;
alter table public.release_email_proposals add column reviewed_context jsonb;
create function public.email_review_context(w uuid,k text,i uuid) returns jsonb
language sql stable security definer set search_path='' as $$
 select jsonb_build_object('artist',a.record_id,'artist_version',a.version,'artist_archived',a.archived_at,
 'release',r.id,'release_version',case when k='task' then r.version end,'release_archived',r.archived_at)
 from (select t.artist_id,t.release_id from public.tasks t where k='task' and t.workspace_id=w and t.id=i
 union all select r.artist_id,r.id from public.releases r where k='release' and r.workspace_id=w and r.id=i) target
 join public.artists a on a.workspace_id=w and a.record_id=target.artist_id
 left join public.releases r on r.workspace_id=w and r.id=target.release_id
$$;
-- Evidence must support the proposed full date, including direct RPC callers.
create function public.email_quote_has_date(q text,d date) returns boolean
language plpgsql immutable set search_path='' as $$
declare normalized text; m text;short_m text;day text;year text;
begin
 if q is null or d is null then return false;end if;
 if q ~ ('\m'||d::text||'\M') then return true;end if;
 normalized:=lower(regexp_replace(q,'([0-9])(st|nd|rd|th)\M','\1','gi'));
 normalized:=regexp_replace(normalized,'[.,]','','g');
 normalized:=regexp_replace(normalized,'[[:space:]]+',' ','g');
 m:=lower(to_char(d,'FMMonth'));short_m:=lower(to_char(d,'Mon'));day:=to_char(d,'FMDD');year:=to_char(d,'YYYY');
 return normalized ~ ('\m('||m||'|'||short_m||case when short_m='sep' then '|sept' else '' end||') 0?'||day||' '||year||'\M')
 or normalized ~ ('\m0?'||day||' ('||m||'|'||short_m||case when short_m='sep' then '|sept' else '' end||') '||year||'\M');
end $$;
revoke all on function public.email_quote_has_date(text,date) from public,anon,authenticated;
create function public.capture_email_review_context() returns trigger language plpgsql security definer set search_path='' as $$
declare source_body text;proposed date;
begin
 select body into source_body from public.inbox_messages where workspace_id=new.workspace_id and id=new.message_id for update;
 proposed:=case when TG_TABLE_NAME='deadline_proposals' then (to_jsonb(new)->>'proposed_due_date')::date else (to_jsonb(new)->>'proposed_date')::date end;
 if source_body is null or position(new.evidence in source_body)=0 or not public.email_quote_has_date(new.evidence,proposed) then raise exception 'The source quote must contain the proposed full date';end if;
 if TG_TABLE_NAME='deadline_proposals' then
 if exists(select 1 from public.release_email_proposals where workspace_id=new.workspace_id and message_id=new.message_id) then raise exception 'Email already has a release proposal';end if;
 new.reviewed_context:=public.email_review_context(new.workspace_id,'task',new.task_id);
 else
 if exists(select 1 from public.deadline_proposals where workspace_id=new.workspace_id and message_id=new.message_id) then raise exception 'Email already has a task proposal';end if;
 new.reviewed_context:=public.email_review_context(new.workspace_id,'release',new.release_id);
 end if;
 return new;
end $$;
create trigger capture_email_context before insert on public.deadline_proposals for each row execute function public.capture_email_review_context();
create trigger capture_email_context before insert on public.release_email_proposals for each row execute function public.capture_email_review_context();
create function public.log_task_email_review() returns trigger language plpgsql security definer set search_path='' as $$
begin
 insert into public.workspace_activity(workspace_id,actor_id,entity_type,entity_id,action,title,current_data)
 values(new.workspace_id,auth.uid(),'proposal',new.id,'created','Task deadline review: '||new.task_title,
 jsonb_build_object('message_id',new.message_id,'task_id',new.task_id,'previous_date',new.previous_due_date,'proposed_date',new.proposed_due_date,'status',new.status));
 return new;
end $$;
create trigger task_email_review_activity after insert on public.deadline_proposals for each row execute function public.log_task_email_review();
revoke all on function public.log_task_email_review() from public,anon,authenticated;
revoke all on function public.email_review_context(uuid,text,uuid),public.capture_email_review_context() from public,anon,authenticated;

-- Preserve the existing 026 permission wrapper. Analyze persisted pasted emails too.
do $$ declare definition text; begin
 select pg_get_functiondef('public.private26_save_gmail_analysis(uuid,uuid,integer,uuid,integer,date,text,text)'::regprocedure) into definition;
 definition:=replace(definition,'source=''gmail''' ,'source in (''gmail'',''ai'',''manual'')');
 definition:=replace(definition,'if exists(select 1 from public.deadline_proposals where message_id=m.id)','if exists(select 1 from public.deadline_proposals where message_id=m.id) or exists(select 1 from public.release_email_proposals where message_id=m.id)');
 execute definition;
 -- Personal deduplication avoids returning another manager's private pasted message.
 select pg_get_functiondef('public.private26_import_ai_email(uuid,text,text,text,uuid,integer,date,text,text)'::regprocedure) into definition;
 execute replace(definition,'jsonb_build_array(''ai'',','jsonb_build_array(''ai'',auth.uid(),');
 -- Release approval compares the saved artist context as well as the release version.
 select pg_get_functiondef('public.decide_email_release(uuid,uuid,boolean)'::regprocedure) into definition;
 definition:=replace(definition,'if p.status<>''pending'' then return p.status;end if;','perform 1 from public.artists where workspace_id=p_workspace and record_id=r.artist_id for share; if p.status<>''pending'' then return p.status;end if;');
 execute replace(definition,'elsif r.version<>p.expected_version','elsif p.reviewed_context is null or p.reviewed_context is distinct from public.email_review_context(p_workspace,''release'',r.id) or r.version<>p.expected_version');
end $$;

create or replace function public.private26_decide_deadline_proposal(p_id uuid,p_approve boolean)
returns text language plpgsql security definer set search_path='' as $$
declare p public.deadline_proposals%rowtype;t public.tasks%rowtype;r public.releases%rowtype;result text;note text;
begin
 select * into p from public.deadline_proposals where id=p_id for update;
 if not found or p_approve is null or coalesce(public.workspace_role(p.workspace_id),'viewer') not in ('owner','manager')
 or not public.can_access_message(p.workspace_id,p.message_id) or not public.can_access_task(p.workspace_id,p.task_id) then raise exception 'Manager access required' using errcode='42501';end if;
 if p.status<>'pending' then return p.status;end if;
 -- Match release-revision lock order: release, then task.
 select r0.* into r from public.releases r0 join public.tasks t0 on t0.release_id=r0.id and t0.workspace_id=r0.workspace_id where t0.id=p.task_id and t0.workspace_id=p.workspace_id for update of r0;
 select * into t from public.tasks where id=p.task_id and workspace_id=p.workspace_id for update;
 perform 1 from public.artists where workspace_id=p.workspace_id and record_id=t.artist_id for share;
 if not p_approve then result:='rejected';note:='Rejected. No task dates changed.';
 elsif t.id is null or t.version<>p.expected_version or t.due_date is distinct from p.previous_due_date or t.status='Complete' or t.archived_at is not null
 or p.reviewed_context is null or p.reviewed_context is distinct from public.email_review_context(p.workspace_id,'task',t.id)
 or exists(select 1 from public.artists where record_id=t.artist_id and archived_at is not null) or r.archived_at is not null then
 result:='conflict';note:='Task, artist or project changed since review. No dates changed.';
 elsif r.format in ('Single','EP','Album') and p.proposed_due_date>r.release_date then
 result:='conflict';note:='The proposed task deadline is after the release date. No dates changed. Review the schedule first.';
 else
 update public.tasks set due_date=p.proposed_due_date where id=t.id and workspace_id=p.workspace_id;
 result:='approved';note:='Task deadline saved. No emails sent or Calendar events changed.';
 end if;
 update public.deadline_proposals set status=result,decided_by=auth.uid(),decided_at=now(),decision_note=note where id=p.id;
 insert into public.workspace_activity(workspace_id,actor_id,entity_type,entity_id,action,title,previous_data,current_data)
 values(p.workspace_id,auth.uid(),'proposal',p.id,result,p.task_title||' — deadline '||result,
 jsonb_build_object('date',p.previous_due_date,'message_id',p.message_id),
 jsonb_build_object('status',result,'result',note,'task_id',p.task_id,'message_id',p.message_id,'date',case when result='approved' then p.proposed_due_date else t.due_date end));
 return result;
end $$;
commit;
