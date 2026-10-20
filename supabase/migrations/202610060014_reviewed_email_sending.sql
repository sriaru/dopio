-- Apply after 013. Each draft can have one outgoing attempt, never automatic retries.
begin;
alter table public.gmail_connections add column can_send boolean not null default false;
create table public.task_email_sends (
 draft_id uuid primary key references public.task_email_drafts(id) on delete restrict,
 workspace_id uuid not null references public.workspaces(id) on delete cascade,
 actor_id uuid not null references auth.users(id),
 attempt_id uuid not null unique,
 status text not null check(status in ('sending','sent','unknown')),
 provider_id text,
 created_at timestamptz not null default now()
);
alter table public.task_email_sends enable row level security;
revoke all on public.task_email_sends from public,anon,authenticated;
grant select on public.task_email_sends to authenticated;
create policy email_send_members on public.task_email_sends for select to authenticated using(workspace_id in(select workspace_id from public.workspace_members where user_id=(select auth.uid())));
create function public.claim_task_email_send(p_workspace uuid,p_draft uuid,p_version integer,p_connection uuid,p_attempt uuid) returns boolean
language plpgsql security definer set search_path='' as $$
declare d public.task_email_drafts%rowtype;
begin
 if auth.uid() is null or not exists(select 1 from public.workspace_members where workspace_id=p_workspace and user_id=auth.uid()) then raise exception 'Access denied' using errcode='42501'; end if;
 perform pg_advisory_xact_lock(hashtextextended(p_draft::text,13));
 select * into d from public.task_email_drafts where workspace_id=p_workspace and id=p_draft for update;
 if not found or p_version is null or d.version<>p_version then raise exception 'Draft changed. Review again.' using errcode='40001'; end if;
 if not exists(select 1 from public.gmail_connections where workspace_id=p_workspace and user_id=auth.uid() and connection_id=p_connection and can_send) then raise exception 'Reconnect Gmail with send access'; end if;
 insert into public.task_email_sends(draft_id,workspace_id,actor_id,attempt_id,status) values(p_draft,p_workspace,auth.uid(),p_attempt,'sending') on conflict(draft_id) do nothing;
 return found;
end $$;
create function public.finish_task_email_send(p_workspace uuid,p_attempt uuid,p_provider text) returns void
language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null or not exists(select 1 from public.workspace_members where workspace_id=p_workspace and user_id=auth.uid()) then raise exception 'Access denied' using errcode='42501'; end if;
 update public.task_email_sends set status=case when p_provider is null then 'unknown' else 'sent' end,provider_id=p_provider where workspace_id=p_workspace and actor_id=auth.uid() and attempt_id=p_attempt and status='sending';
end $$;
-- Freeze the reviewed message once a send is claimed (including an uncertain result).
create function public.freeze_sending_draft() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if exists(select 1 from public.task_email_sends where draft_id=old.id) then raise exception 'This draft has a send attempt and cannot be edited.'; end if;
 return new;
end $$;
create trigger sending_draft_immutable before update on public.task_email_drafts for each row execute function public.freeze_sending_draft();
revoke all on function public.claim_task_email_send(uuid,uuid,integer,uuid,uuid),public.finish_task_email_send(uuid,uuid,text),public.freeze_sending_draft() from public,anon;
grant execute on function public.claim_task_email_send(uuid,uuid,integer,uuid,uuid),public.finish_task_email_send(uuid,uuid,text) to authenticated;
commit;
