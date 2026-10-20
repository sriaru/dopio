-- Apply after 012. Internal drafts only; no Gmail write permissions required.
begin;
create table public.task_email_drafts (
 id uuid primary key,
 workspace_id uuid not null references public.workspaces(id) on delete cascade,
 task_id uuid not null,
 recipient text not null check(char_length(recipient)<=254 and recipient ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'),
 subject text not null check(char_length(trim(subject)) between 1 and 200 and subject !~ E'[\r\n]'),
 body text not null check(char_length(trim(body)) between 1 and 20000),
 version integer not null default 1,
 updated_at timestamptz not null default now(),
 foreign key(workspace_id,task_id) references public.tasks(workspace_id,id) on delete cascade
);
alter table public.task_email_drafts enable row level security;
revoke all on public.task_email_drafts from public,anon,authenticated;
grant select on public.task_email_drafts to authenticated;
create policy draft_members on public.task_email_drafts for select to authenticated using(workspace_id in(select workspace_id from public.workspace_members where user_id=(select auth.uid())));
create function public.save_task_email_draft(p_workspace uuid,p_id uuid,p_task uuid,p_version integer,p_recipient text,p_subject text,p_body text) returns integer
language plpgsql security definer set search_path='' as $$
declare d public.task_email_drafts%rowtype; next_version integer;
begin
 if auth.uid() is null or not exists(select 1 from public.workspace_members where workspace_id=p_workspace and user_id=auth.uid()) then raise exception 'Access denied' using errcode='42501'; end if;
 if p_id is null or not exists(select 1 from public.tasks where workspace_id=p_workspace and id=p_task) then raise exception 'Task unavailable'; end if;
 perform pg_advisory_xact_lock(hashtextextended(p_id::text,13));
 select * into d from public.task_email_drafts where id=p_id;
 if found then
  if d.workspace_id<>p_workspace or d.task_id<>p_task then raise exception 'Draft unavailable' using errcode='42501'; end if;
  if d.recipient=p_recipient and d.subject=p_subject and d.body=p_body then return d.version; end if;
  if p_version is null or d.version<>p_version then raise exception 'Draft changed. Reload first.' using errcode='40001'; end if;
  next_version:=d.version+1;
  update public.task_email_drafts set recipient=p_recipient,subject=p_subject,body=p_body,version=next_version,updated_at=now() where id=p_id;
 else
  if p_version is distinct from 0 then raise exception 'Draft unavailable'; end if;
  next_version:=1;
  insert into public.task_email_drafts(id,workspace_id,task_id,recipient,subject,body) values(p_id,p_workspace,p_task,p_recipient,p_subject,p_body);
 end if;
 return next_version;
end $$;
revoke all on function public.save_task_email_draft(uuid,uuid,uuid,integer,text,text,text) from public,anon;
grant execute on function public.save_task_email_draft(uuid,uuid,uuid,integer,text,text,text) to authenticated;
commit;
