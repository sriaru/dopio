-- Apply after 003. AI produces proposals only; existing approval RPC applies them.
begin;
alter table public.inbox_messages drop constraint inbox_messages_source_check;
alter table public.inbox_messages add constraint inbox_messages_source_check check(source in ('sample','manual','ai'));
create table public.email_ai_usage (
 workspace_id uuid primary key references public.workspaces(id) on delete cascade,
 window_start timestamptz not null, attempts integer not null
);
alter table public.email_ai_usage enable row level security;
revoke all on public.email_ai_usage from anon,authenticated;
create function public.reserve_email_analysis(p_workspace uuid) returns boolean
language plpgsql security definer set search_path='' as $$
declare n integer;
begin
 if auth.uid() is null or not exists(select 1 from public.workspace_members where workspace_id=p_workspace and user_id=auth.uid()) then raise exception 'Workspace access denied' using errcode='42501'; end if;
 insert into public.email_ai_usage values(p_workspace,now(),1)
 on conflict(workspace_id) do update set
 attempts=case when public.email_ai_usage.window_start < now()-interval '1 minute' then 1 else public.email_ai_usage.attempts+1 end,
 window_start=case when public.email_ai_usage.window_start < now()-interval '1 minute' then now() else public.email_ai_usage.window_start end
 returning attempts into n;
 return n<=10;
end $$;
revoke all on function public.reserve_email_analysis(uuid) from public,anon;
grant execute on function public.reserve_email_analysis(uuid) to authenticated;
create function public.import_ai_email(p_workspace uuid,p_sender text,p_subject text,p_body text,p_task uuid,p_version integer,p_date date,p_evidence text,p_note text)
returns uuid language plpgsql security definer set search_path='' as $$
declare m uuid; v_fingerprint text; t public.tasks%rowtype; artist text; release text; state text:='needs_context';
begin
 if auth.uid() is null or not exists(select 1 from public.workspace_members where workspace_id=p_workspace and user_id=auth.uid()) then raise exception 'Workspace access denied' using errcode='42501'; end if;
 if p_sender is null or char_length(trim(p_sender)) not between 1 and 254 or p_subject is null or char_length(trim(p_subject)) not between 1 and 200 or p_body is null or char_length(trim(p_body)) not between 1 and 20000 or p_note is null or char_length(trim(p_note)) not between 1 and 1200 then raise exception 'Invalid email'; end if;
 v_fingerprint:=md5(jsonb_build_array('ai',trim(p_sender),trim(p_subject),trim(p_body))::text);
 perform pg_advisory_xact_lock(hashtextextended(p_workspace::text||v_fingerprint,0));
 select id into m from public.inbox_messages where workspace_id=p_workspace and inbox_messages.fingerprint=v_fingerprint;
 if m is not null then return m; end if;
 if p_task is not null then
  if p_date is null or p_date not between '1900-01-01'::date and '2199-12-31'::date or p_evidence is null or char_length(trim(p_evidence)) not between 1 and 2000 or position(p_evidence in p_body)=0 then raise exception 'Invalid evidence or date'; end if;
  select * into t from public.tasks where id=p_task and workspace_id=p_workspace for update;
  if not found then raise exception 'Task not found' using errcode='42501'; end if;
  if p_version is null or t.version<>p_version or t.status='Complete' then
   p_note:='The task changed during analysis. No proposal was created. Paste an updated email to analyze again.';
  elsif t.due_date is not distinct from p_date then state:='no_change';p_note:='The task already has this deadline.';
  else
   select name into artist from public.artists where record_id=t.artist_id and workspace_id=p_workspace;
   if artist is null then raise exception 'Task must have an artist'; end if;
   select title into release from public.releases where id=t.release_id and workspace_id=p_workspace;
   state:='proposal';
  end if;
 elsif p_date is not null then raise exception 'Task required for deadline';
 end if;
 insert into public.inbox_messages(workspace_id,source,sender,subject,body,fingerprint,analysis_status,analysis_note)
 values(p_workspace,'ai',trim(p_sender),trim(p_subject),p_body,v_fingerprint,state,p_note) returning id into m;
 if state='proposal' then
  insert into public.deadline_proposals(workspace_id,message_id,task_id,task_title,artist_name,release_title,previous_due_date,proposed_due_date,expected_version,evidence)
  values(p_workspace,m,t.id,t.title,artist,release,t.due_date,p_date,t.version,p_evidence);
 end if;
 insert into public.workspace_activity(workspace_id,actor_id,entity_type,entity_id,action,title) values(p_workspace,auth.uid(),'email',m,'imported',trim(p_subject));
 return m;
end $$;
revoke all on function public.import_ai_email(uuid,text,text,text,uuid,integer,date,text,text) from public,anon;
grant execute on function public.import_ai_email(uuid,text,text,text,uuid,integer,date,text,text) to authenticated;
commit;
