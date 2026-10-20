-- Apply after 014. Block identical task messages across separate drafts.
begin;
create or replace function public.claim_task_email_send(p_workspace uuid,p_draft uuid,p_version integer,p_connection uuid,p_attempt uuid) returns boolean
language plpgsql security definer set search_path='' as $$
declare d public.task_email_drafts%rowtype;
begin
 if auth.uid() is null or not exists(select 1 from public.workspace_members where workspace_id=p_workspace and user_id=auth.uid()) then raise exception 'Access denied' using errcode='42501'; end if;
 perform pg_advisory_xact_lock(hashtextextended(p_workspace::text,15));
 perform pg_advisory_xact_lock(hashtextextended(p_draft::text,13));
 select * into d from public.task_email_drafts where workspace_id=p_workspace and id=p_draft for update;
 if not found or p_version is null or d.version<>p_version then raise exception 'Draft changed. Review again.' using errcode='40001'; end if;
 if not exists(select 1 from public.gmail_connections where workspace_id=p_workspace and user_id=auth.uid() and connection_id=p_connection and can_send) then raise exception 'Reconnect Gmail with send access'; end if;
 -- Check all prior attempts, including uncertain results and other draft IDs.
 if exists(select 1 from public.task_email_sends s join public.task_email_drafts old on old.id=s.draft_id
 where s.workspace_id=p_workspace and old.task_id=d.task_id
 and lower(trim(old.recipient))=lower(trim(d.recipient)) and trim(old.subject)=trim(d.subject)
 and replace(trim(old.body),E'\r\n',E'\n')=replace(trim(d.body),E'\r\n',E'\n')) then return false; end if;
 insert into public.task_email_sends(draft_id,workspace_id,actor_id,attempt_id,status) values(p_draft,p_workspace,auth.uid(),p_attempt,'sending') on conflict(draft_id) do nothing;
 return found;
end $$;
commit;
