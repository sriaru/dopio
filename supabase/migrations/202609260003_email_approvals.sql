-- Apply after migrations 001 and 002. This enables sample/manual email review;
-- it does not connect Gmail or call an AI provider.
begin;
alter table public.tasks add column version integer not null default 1;
alter table public.tasks add constraint tasks_workspace_id_key unique(workspace_id,id);
create function public.bump_task_version() returns trigger language plpgsql set search_path='' as $$
begin NEW.version:=OLD.version+1; return NEW; end $$;
create trigger task_version before update on public.tasks for each row execute function public.bump_task_version();
revoke all on function public.bump_task_version() from public,anon,authenticated;
create table public.inbox_messages(
 id uuid primary key default gen_random_uuid(),
 workspace_id uuid not null references public.workspaces(id) on delete cascade,
 source text not null check(source in ('sample','manual')),
 sender text not null check(char_length(sender) between 1 and 254),
 subject text not null check(char_length(subject) between 1 and 200),
 body text not null check(char_length(body) between 1 and 20000),
 fingerprint text not null,
 analysis_status text not null check(analysis_status in ('proposal','needs_context','no_change')),
 analysis_note text not null,
 created_at timestamptz not null default now(),
 unique(workspace_id,id),unique(workspace_id,fingerprint)
);
create table public.deadline_proposals(
 id uuid primary key default gen_random_uuid(),
 workspace_id uuid not null references public.workspaces(id) on delete cascade,
 message_id uuid not null,
 task_id uuid,
 task_title text not null,
 artist_name text not null,
 release_title text,
 previous_due_date date,
 proposed_due_date date not null check(proposed_due_date between '1900-01-01'::date and '2199-12-31'::date),
 expected_version integer not null,
 evidence text not null,
 status text not null default 'pending' check(status in ('pending','approved','rejected','conflict')),
 decided_by uuid references auth.users(id) on delete set null,
 decided_at timestamptz,
 decision_note text,
 created_at timestamptz not null default now(),
 unique(message_id),
 foreign key(workspace_id,message_id) references public.inbox_messages(workspace_id,id) on delete cascade,
 foreign key(workspace_id,task_id) references public.tasks(workspace_id,id) on delete set null(task_id)
);
create index inbox_workspace_created on public.inbox_messages(workspace_id,created_at desc);
create index proposals_workspace_status on public.deadline_proposals(workspace_id,status,created_at desc);
alter table public.inbox_messages enable row level security;
alter table public.deadline_proposals enable row level security;
revoke all on public.inbox_messages,public.deadline_proposals from anon,authenticated;
grant select on public.inbox_messages,public.deadline_proposals to authenticated;
create policy inbox_member_read on public.inbox_messages for select to authenticated using(workspace_id in(select workspace_id from public.workspace_members where user_id=(select auth.uid())));
create policy proposals_member_read on public.deadline_proposals for select to authenticated using(workspace_id in(select workspace_id from public.workspace_members where user_id=(select auth.uid())));
alter table public.workspace_activity drop constraint workspace_activity_entity_type_check;
alter table public.workspace_activity add constraint workspace_activity_entity_type_check check(entity_type in ('artist','release','task','email','proposal'));
alter table public.workspace_activity drop constraint workspace_activity_action_check;
alter table public.workspace_activity add constraint workspace_activity_action_check check(action in ('created','updated','deleted','imported','approved','rejected','conflict'));

-- Deliberately limited, deterministic extraction. Only explicit labeled fields
-- are interpreted. Body content is data; it cannot call tools or perform edits.
create function public.import_deadline_email(p_workspace uuid,p_source text,p_sender text,p_subject text,p_body text)
returns uuid language plpgsql security definer set search_path='' as $$
declare
 v_message uuid; v_fingerprint text; v_artist text; v_title text; v_release text;
 v_date_text text; v_date date; v_note text; v_status text:='needs_context';
 v_task public.tasks%rowtype; v_task_id uuid; v_count integer; v_fields integer;
begin
 if auth.uid() is null or not exists(select 1 from public.workspace_members where workspace_id=p_workspace and user_id=auth.uid()) then raise exception 'Workspace access denied' using errcode='42501'; end if;
 if p_source is null or p_source not in ('sample','manual') or p_sender is null or char_length(trim(p_sender)) not between 1 and 254 or p_subject is null or char_length(trim(p_subject)) not between 1 and 200 or p_body is null or char_length(trim(p_body)) not between 1 and 20000 then raise exception 'Invalid email' using errcode='22023'; end if;
 p_body:=replace(p_body,E'\r\n',E'\n');
 v_fingerprint:=md5(jsonb_build_array(p_source,trim(p_sender),trim(p_subject),trim(p_body))::text);
 perform pg_advisory_xact_lock(hashtextextended(p_workspace::text||v_fingerprint,0));
 select id into v_message from public.inbox_messages where workspace_id=p_workspace and fingerprint=v_fingerprint;
 if v_message is not null then return v_message; end if;
 v_artist:=trim((regexp_match(p_body,'(?n)^Artist: ([^\n\r]+)$'))[1]);
 v_title:=trim((regexp_match(p_body,'(?n)^Task: ([^\n\r]+)$'))[1]);
 v_release:=trim((regexp_match(p_body,'(?n)^Release: ([^\n\r]+)$'))[1]);
 v_date_text:=(regexp_match(p_body,'(?n)^New deadline: ([0-9]{4}-[0-9]{2}-[0-9]{2})$'))[1];
 select count(*) into v_fields from regexp_matches(p_body,'(?n)^(Artist|Task|Release|New deadline): [^\n\r]+$','g');
 v_note:='Add exactly one Artist, Task, and New deadline line (YYYY-MM-DD). Use Release to distinguish similar tasks. Dates are never guessed.';
 if v_artist is not null and v_title is not null and v_date_text is not null and v_fields=(case when v_release is null then 3 else 4 end) then
  begin v_date:=v_date_text::date; exception when invalid_datetime_format or datetime_field_overflow then v_date:=null; end;
  if v_date is null or v_date not between '1900-01-01'::date and '2199-12-31'::date then v_note:='The deadline is not a valid supported date. Import a corrected email.';
  else
   select count(*),min(t.id::text)::uuid into v_count,v_task_id from public.tasks t join public.artists a on a.record_id=t.artist_id and a.workspace_id=t.workspace_id left join public.releases r on r.id=t.release_id and r.workspace_id=t.workspace_id
   where t.workspace_id=p_workspace and lower(trim(a.name))=lower(v_artist) and lower(trim(t.title))=lower(v_title) and (v_release is null or lower(trim(r.title))=lower(v_release));
   if v_count=0 then v_note:='No matching artist task was found in this workspace. Create the task or correct the labeled fields, then import again.';
   elsif v_count>1 then v_note:='Multiple tasks match. Add a Release line or give the intended task a distinct title, then import again.';
   else
    select * into v_task from public.tasks where id=v_task_id and workspace_id=p_workspace for update;
    if not found then v_note:='This task was removed. Import again after selecting an existing task.';
    elsif v_task.status='Complete' then v_note:='This task is already complete. No deadline update was proposed.';v_status:='no_change';
    elsif v_task.due_date is not distinct from v_date then v_note:='The task already has this deadline. No change is needed.';v_status:='no_change';
    else v_status:='proposal';v_note:='Matched the explicit artist and task fields to one saved task. Review the proposed date alongside the original email.';
    end if;
   end if;
  end if;
 end if;
 insert into public.inbox_messages(workspace_id,source,sender,subject,body,fingerprint,analysis_status,analysis_note)
 values(p_workspace,p_source,trim(p_sender),trim(p_subject),p_body,v_fingerprint,v_status,v_note) returning id into v_message;
 if v_status='proposal' then
  insert into public.deadline_proposals(workspace_id,message_id,task_id,task_title,artist_name,release_title,previous_due_date,proposed_due_date,expected_version,evidence)
  values(p_workspace,v_message,v_task.id,v_task.title,v_artist,v_release,v_task.due_date,v_date,v_task.version,'New deadline: '||v_date_text);
 end if;
 insert into public.workspace_activity(workspace_id,actor_id,entity_type,entity_id,action,title) values(p_workspace,auth.uid(),'email',v_message,'imported',trim(p_subject));
 return v_message;
end $$;
revoke all on function public.import_deadline_email(uuid,text,text,text,text) from public,anon;
grant execute on function public.import_deadline_email(uuid,text,text,text,text) to authenticated;

-- Lock the proposal and task, re-check the version, then apply and resolve in
-- one transaction. Repeat clicks are idempotent. No external email is sent.
create function public.decide_deadline_proposal(p_id uuid,p_approve boolean)
returns text language plpgsql security definer set search_path='' as $$
declare p public.deadline_proposals%rowtype; t public.tasks%rowtype; result text; note text;
begin
 if auth.uid() is null or p_approve is null then raise exception 'Authentication required' using errcode='42501'; end if;
 select * into p from public.deadline_proposals where id=p_id and workspace_id in(select workspace_id from public.workspace_members where user_id=auth.uid()) for update;
 if not found then raise exception 'Proposal not found' using errcode='42501'; end if;
 if p.status<>'pending' then return p.status; end if;
 if not p_approve then result:='rejected';note:='Rejected by reviewer. The task was not changed.';
 else
  select * into t from public.tasks where id=p.task_id and workspace_id=p.workspace_id for update;
  if not found or t.version<>p.expected_version or t.due_date is distinct from p.previous_due_date or t.status='Complete' then
   result:='conflict';note:='The task was changed or deleted after this proposal was created. Nothing was overwritten. Create a new proposal from the current task.';
  else
   update public.tasks set due_date=p.proposed_due_date where id=t.id and workspace_id=p.workspace_id;
   result:='approved';note:='Task deadline updated to '||p.proposed_due_date::text||' after review.';
  end if;
 end if;
 update public.deadline_proposals set status=result,decided_by=auth.uid(),decided_at=now(),decision_note=note where id=p.id;
 insert into public.workspace_activity(workspace_id,actor_id,entity_type,entity_id,action,title)
 values(p.workspace_id,auth.uid(),'proposal',p.id,result,p.task_title||' — deadline '||result);
 return result;
end $$;
revoke all on function public.decide_deadline_proposal(uuid,boolean) from public,anon;
grant execute on function public.decide_deadline_proposal(uuid,boolean) to authenticated;
commit;
