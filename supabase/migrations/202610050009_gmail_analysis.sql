-- Apply after 008. AI results attach to the original Gmail import.
begin;
alter table public.inbox_messages add column gmail_analysis_version integer not null default 0;
create function public.save_gmail_analysis(p_workspace uuid,p_message uuid,p_revision integer,p_task uuid,p_version integer,p_date date,p_evidence text,p_note text)
returns text language plpgsql security definer set search_path='' as $$
declare m public.inbox_messages%rowtype; t public.tasks%rowtype; artist text; release text; result text:='needs_context';
begin
 if auth.uid() is null or not exists(select 1 from public.workspace_members where workspace_id=p_workspace and user_id=auth.uid()) then raise exception 'Workspace access denied' using errcode='42501'; end if;
 select * into m from public.inbox_messages where id=p_message and workspace_id=p_workspace and source='gmail' for update;
 if not found then raise exception 'Gmail message not found' using errcode='42501'; end if;
 if exists(select 1 from public.deadline_proposals where message_id=m.id) then return 'proposal'; end if;
 if p_revision is null or p_revision<>m.gmail_analysis_version then raise exception 'Analysis changed. Refresh before retrying.' using errcode='40001'; end if;
 if p_note is null or char_length(trim(p_note)) not between 1 and 1200 then raise exception 'Invalid analysis'; end if;
 if p_task is not null then
  if p_date is null or p_date not between '1900-01-01'::date and '2199-12-31'::date or p_evidence is null or char_length(trim(p_evidence)) not between 1 and 2000 or position(p_evidence in m.body)=0 then raise exception 'Invalid evidence or date'; end if;
  select * into t from public.tasks where id=p_task and workspace_id=p_workspace for update;
  if not found then raise exception 'Task not found' using errcode='42501'; end if;
  if p_version is null or t.version<>p_version or t.status='Complete' then p_note:='The task changed during analysis. No proposal was created. Refresh and analyze again.';
  elsif t.due_date is not distinct from p_date then result:='no_change';p_note:='This task already has the proposed deadline.';
  else
   select name into artist from public.artists where workspace_id=p_workspace and record_id=t.artist_id;
   if artist is null then raise exception 'Artist required'; end if;
   select title into release from public.releases where workspace_id=p_workspace and id=t.release_id;
   result:='proposal';
   insert into public.deadline_proposals(workspace_id,message_id,task_id,task_title,artist_name,release_title,previous_due_date,proposed_due_date,expected_version,evidence)
   values(p_workspace,m.id,t.id,t.title,artist,release,t.due_date,p_date,t.version,p_evidence);
  end if;
 elsif p_date is not null then raise exception 'Task required';
 end if;
 update public.inbox_messages set analysis_status=result,analysis_note='AI analysis: '||p_note||' Source: Gmail ('||coalesce(m.provider_account,'unknown')||'). No task changes occur without approval.',gmail_analysis_version=gmail_analysis_version+1 where id=m.id;
 insert into public.workspace_activity(workspace_id,actor_id,entity_type,entity_id,action,title) values(p_workspace,auth.uid(),'email',m.id,'updated','Analyzed Gmail email — '||m.subject);
 return result;
end $$;
revoke all on function public.save_gmail_analysis(uuid,uuid,integer,uuid,integer,date,text,text) from public,anon;
grant execute on function public.save_gmail_analysis(uuid,uuid,integer,uuid,integer,date,text,text) to authenticated;
commit;
