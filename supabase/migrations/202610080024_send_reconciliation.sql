-- Apply after 023. Positive provider evidence can resolve an uncertain send; never unlock it.
begin;
alter table public.task_email_sends add column sender_email text;
create function public.capture_send_account() returns trigger language plpgsql security definer set search_path='' as $$
begin
 select email into new.sender_email from public.gmail_connections where workspace_id=new.workspace_id and user_id=new.actor_id;
 return new;
end $$;
create trigger capture_send_account before insert on public.task_email_sends for each row execute function public.capture_send_account();
revoke all on function public.capture_send_account() from public,anon,authenticated;
create function public.reconcile_task_email_send(p_workspace uuid,p_attempt uuid,p_provider text) returns void language plpgsql security definer set search_path='' as $$
begin
 if coalesce(public.workspace_role(p_workspace),'') not in ('owner','manager') then raise exception 'Manager required' using errcode='42501'; end if;
 if p_provider is null or char_length(p_provider) not between 1 and 200 then raise exception 'Provider confirmation required'; end if;
 update public.task_email_sends set status='sent',provider_id=p_provider where workspace_id=p_workspace and actor_id=auth.uid() and attempt_id=p_attempt and status in ('sending','unknown');
end $$;
revoke all on function public.reconcile_task_email_send(uuid,uuid,text) from public,anon;
grant execute on function public.reconcile_task_email_send(uuid,uuid,text) to authenticated;
commit;
