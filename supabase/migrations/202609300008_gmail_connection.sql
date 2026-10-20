-- Apply once after 007. One private Gmail connection per member/workspace.
begin;
create table public.gmail_connections (
 workspace_id uuid not null references public.workspaces(id) on delete cascade,
 user_id uuid not null references auth.users(id) on delete cascade,
 connection_id uuid not null default gen_random_uuid(),
 email text not null check(char_length(email) between 3 and 254),
 encrypted_refresh_token text not null check(char_length(encrypted_refresh_token) between 20 and 20000),
 connected_at timestamptz not null default now(),
 primary key(workspace_id,user_id)
);
alter table public.gmail_connections enable row level security;
revoke all on public.gmail_connections from public,anon,authenticated;
grant select,insert,update,delete on public.gmail_connections to authenticated;
create policy gmail_own_connection on public.gmail_connections for all to authenticated
 using(user_id=(select auth.uid()) and workspace_id in(select workspace_id from public.workspace_members where user_id=(select auth.uid())))
 with check(user_id=(select auth.uid()) and workspace_id in(select workspace_id from public.workspace_members where user_id=(select auth.uid())));
alter table public.inbox_messages drop constraint inbox_messages_source_check;
alter table public.inbox_messages add constraint inbox_messages_source_check check(source in ('sample','manual','ai','gmail'));
alter table public.inbox_messages add column provider_message_id text;
alter table public.inbox_messages add column provider_account text;
alter table public.inbox_messages add column received_at timestamptz;
create unique index gmail_message_identity on public.inbox_messages(workspace_id,provider_account,provider_message_id) where source='gmail';
create function public.import_gmail_message(p_workspace uuid,p_connection uuid,p_message_id text,p_sender text,p_subject text,p_body text,p_received timestamptz)
returns uuid language plpgsql security definer set search_path='' as $$
declare mailbox text; message uuid; fp text;
begin
 if auth.uid() is null or not exists(select 1 from public.workspace_members where workspace_id=p_workspace and user_id=auth.uid()) then raise exception 'Workspace access denied' using errcode='42501'; end if;
 select email into mailbox from public.gmail_connections where workspace_id=p_workspace and user_id=auth.uid() and connection_id=p_connection for share;
 if not found then raise exception 'Gmail connection changed. Reconnect and try again.' using errcode='42501'; end if;
 if p_message_id is null or p_message_id !~ '^[a-zA-Z0-9_-]{1,200}$' or p_sender is null or char_length(trim(p_sender)) not between 1 and 254 or p_subject is null or char_length(trim(p_subject)) not between 1 and 200 or p_body is null or char_length(trim(p_body)) not between 1 and 20000 or p_received is null then raise exception 'Invalid email' using errcode='22023'; end if;
 mailbox:=lower(mailbox);
 fp:=md5(jsonb_build_array('gmail',mailbox,p_message_id)::text);
 perform pg_advisory_xact_lock(hashtextextended(p_workspace::text||fp,0));
 select id into message from public.inbox_messages where workspace_id=p_workspace and fingerprint=fp;
 if message is not null then return message; end if;
 insert into public.inbox_messages(workspace_id,source,sender,subject,body,fingerprint,analysis_status,analysis_note,provider_message_id,provider_account,received_at)
 values(p_workspace,'gmail',trim(p_sender),trim(p_subject),p_body,fp,'needs_context','Imported from Gmail ('||mailbox||'), received '||to_char(p_received at time zone 'UTC','YYYY-MM-DD HH24:MI')||' UTC. Not analyzed by AI. No tasks or artist briefs were changed.',p_message_id,mailbox,p_received) returning id into message;
 insert into public.workspace_activity(workspace_id,actor_id,entity_type,entity_id,action,title) values(p_workspace,auth.uid(),'email',message,'imported',trim(p_subject));
 return message;
end $$;
revoke all on function public.import_gmail_message(uuid,uuid,text,text,text,text,timestamptz) from public,anon;
grant execute on function public.import_gmail_message(uuid,uuid,text,text,text,text,timestamptz) to authenticated;
commit;
