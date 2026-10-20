-- Apply after 033. Provider receipts can only be recorded by the application server.
begin;
revoke all on function public.finish_task_email_send(uuid,uuid,text),public.finish_chat_message(uuid,uuid,text),public.reconcile_task_email_send(uuid,uuid,text) from public,anon,authenticated;
create table public.google_send_results(
 id bigint generated always as identity primary key,
 workspace_id uuid not null references public.workspaces(id) on delete cascade,
 actor_id uuid not null references auth.users(id),kind text not null check(kind in ('task','chat')),
 attempt_id uuid not null,provider_id text,outcome text not null check(outcome in ('accepted','unknown','rejected')),
 created_at timestamptz not null default now()
);
alter table public.google_send_results enable row level security;
revoke all on public.google_send_results from public,anon,authenticated;
grant select on public.google_send_results to authenticated;
create policy private_send_results on public.google_send_results for select to authenticated using(public.workspace_role(workspace_id) is not null and (actor_id=auth.uid() or public.workspace_role(workspace_id)='owner'));
create function public.record_google_send_result(p_kind text,p_workspace uuid,p_actor uuid,p_attempt uuid,p_provider text,p_outcome text) returns boolean
language plpgsql security definer set search_path='' as $$
declare changed integer;
begin
 if p_outcome is null or p_outcome not in ('accepted','unknown','rejected') or (p_outcome='accepted' and (p_provider is null or length(trim(p_provider)) not between 1 and 200)) or (p_outcome<>'accepted' and p_provider is not null) then raise exception 'Invalid provider receipt';end if;
 if p_kind='task' then
 update public.task_email_sends set status=case when p_provider is null then 'unknown' else 'sent' end,provider_id=p_provider where workspace_id=p_workspace and actor_id=p_actor and attempt_id=p_attempt and status in ('sending','unknown');
 elsif p_kind='chat' then
 update public.chat_messages set status=case when p_provider is null then 'unknown' else 'sent' end,provider_id=p_provider,updated_at=now() where workspace_id=p_workspace and user_id=p_actor and attempt_id=p_attempt and status in ('sending','unknown');
 else raise exception 'Invalid send kind';end if;
 get diagnostics changed=row_count;
 if changed<>1 then raise exception 'Send attempt unavailable or already confirmed';end if;
 insert into public.google_send_results(workspace_id,actor_id,kind,attempt_id,provider_id,outcome) values(p_workspace,p_actor,p_kind,p_attempt,p_provider,p_outcome);
 return true;
end $$;
revoke all on function public.record_google_send_result(text,uuid,uuid,uuid,text,text) from public,anon,authenticated;
do $$ begin
 if exists(select 1 from pg_roles where rolname='service_role') then grant execute on function public.record_google_send_result(text,uuid,uuid,uuid,text,text) to service_role;end if;
end $$;
-- Gmail copies are private to the importing member, including shared mailboxes.
drop index public.gmail_message_identity;
create unique index gmail_message_identity on public.inbox_messages(workspace_id,imported_by,provider_account,provider_message_id) where source='gmail';
do $$ declare definition text;begin
 select pg_get_functiondef('public.import_gmail_message(uuid,uuid,text,text,text,text,timestamptz)'::regprocedure) into definition;
 definition:=replace(definition,'jsonb_build_array(''gmail'',mailbox,p_message_id)','jsonb_build_array(''gmail'',auth.uid(),mailbox,p_message_id)');
 definition:=replace(definition,'workspace_id=p_workspace and fingerprint=fp','workspace_id=p_workspace and imported_by=auth.uid() and provider_account=mailbox and provider_message_id=p_message_id and source=''gmail''');
 execute definition;
end $$;
create table public.google_calendar_runs(
 id uuid primary key,workspace_id uuid not null references public.workspaces(id) on delete cascade,
 actor_id uuid not null references auth.users(id),connection_id uuid not null,
 status text not null check(status in ('running','confirmed','partial')),confirmed_events integer not null default 0,
 confirmed_removals integer not null default 0,created_at timestamptz not null default now(),finished_at timestamptz
);
alter table public.google_calendar_runs enable row level security;
revoke all on public.google_calendar_runs from public,anon,authenticated;
grant select on public.google_calendar_runs to authenticated;
create policy private_calendar_runs on public.google_calendar_runs for select to authenticated using(public.workspace_role(workspace_id) is not null and (actor_id=auth.uid() or public.workspace_role(workspace_id)='owner'));
create function public.record_calendar_run(p_id uuid,p_workspace uuid,p_actor uuid,p_connection uuid,p_status text,p_events integer,p_removals integer) returns boolean
language plpgsql security definer set search_path='' as $$
begin
 if p_status is null or p_status not in ('running','confirmed','partial') or p_events is null or p_removals is null or p_events<0 or p_removals<0 then raise exception 'Invalid sync result';end if;
 if p_status='running' then
 if not exists(select 1 from public.calendar_connections where workspace_id=p_workspace and user_id=p_actor and connection_id=p_connection and lease_id=p_id) then raise exception 'Sync claim unavailable';end if;
 insert into public.google_calendar_runs(id,workspace_id,actor_id,connection_id,status) values(p_id,p_workspace,p_actor,p_connection,'running');
 else
 update public.google_calendar_runs set status=p_status,confirmed_events=p_events,confirmed_removals=p_removals,finished_at=now() where id=p_id and workspace_id=p_workspace and actor_id=p_actor and connection_id=p_connection and status='running';
 if not found then raise exception 'Sync result unavailable';end if;
 end if;
 return true;
end $$;
revoke all on function public.record_calendar_run(uuid,uuid,uuid,uuid,text,integer,integer) from public,anon,authenticated;
do $$ begin if exists(select 1 from pg_roles where rolname='service_role') then
 grant execute on function public.record_calendar_run(uuid,uuid,uuid,uuid,text,integer,integer) to service_role;
end if;end $$;

-- Serialize task/chat claims together so switching composers cannot duplicate a send.
create function public.guard_cross_composer_send() returns trigger language plpgsql security definer set search_path='' as $$
declare v_recipient text; v_subject text; v_body text;
begin
 if TG_TABLE_NAME='chat_messages' then
 if new.status<>'sending' or old.status='sending' then return new;end if;
 v_recipient:=new.recipient;v_subject:=new.subject;v_body:=new.body;
 else
 select d.recipient,d.subject,d.body into v_recipient,v_subject,v_body from public.task_email_drafts d where d.id=new.draft_id and d.workspace_id=new.workspace_id;
 end if;
 perform pg_advisory_xact_lock(hashtextextended(new.workspace_id::text,34));
 if TG_TABLE_NAME='chat_messages' then
 if exists(select 1 from public.task_email_sends s join public.task_email_drafts d on d.id=s.draft_id where s.workspace_id=new.workspace_id and lower(trim(d.recipient))=lower(trim(v_recipient)) and trim(d.subject)=trim(v_subject) and replace(trim(d.body),E'\r\n',E'\n')=replace(trim(v_body),E'\r\n',E'\n')) then raise exception 'An identical send was already attempted' using errcode='23505';end if;
 else
 if exists(select 1 from public.chat_messages c where c.workspace_id=new.workspace_id and c.status<>'draft' and lower(trim(c.recipient))=lower(trim(v_recipient)) and trim(c.subject)=trim(v_subject) and replace(trim(c.body),E'\r\n',E'\n')=replace(trim(v_body),E'\r\n',E'\n')) then raise exception 'An identical send was already attempted' using errcode='23505';end if;
 end if;
 return new;
end $$;
revoke all on function public.guard_cross_composer_send() from public,anon,authenticated;
create trigger cross_composer_send before insert on public.task_email_sends for each row execute function public.guard_cross_composer_send();
create trigger cross_composer_send before update on public.chat_messages for each row execute function public.guard_cross_composer_send();

create function public.google_receipts_ready() returns boolean language sql stable set search_path='' as $$select true$$;
revoke all on function public.google_receipts_ready() from public,anon,authenticated;
do $$ begin if exists(select 1 from pg_roles where rolname='service_role') then grant execute on function public.google_receipts_ready() to service_role;end if;end $$;
commit;
