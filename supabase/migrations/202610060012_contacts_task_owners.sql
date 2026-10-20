-- Apply once after 011. Contacts are shared workspace records, not login accounts.
begin;
create table public.workspace_contacts (
 id uuid primary key default gen_random_uuid(),
 workspace_id uuid not null references public.workspaces(id) on delete cascade,
 name text not null check(char_length(trim(name)) between 1 and 100),
 email text not null default '' check(char_length(email)<=254 and (email='' or email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$')),
 role text not null default '' check(char_length(role)<=100),
 created_at timestamptz not null default now(),
 unique(workspace_id,id)
);
create unique index contact_email_unique on public.workspace_contacts(workspace_id,lower(email)) where email<>'';
alter table public.workspace_contacts enable row level security;
revoke all on public.workspace_contacts from public,anon,authenticated;
grant select,delete on public.workspace_contacts to authenticated;
grant insert(workspace_id,name,email,role),update(name,email,role) on public.workspace_contacts to authenticated;
create policy contacts_members on public.workspace_contacts for all to authenticated
 using(workspace_id in(select workspace_id from public.workspace_members where user_id=(select auth.uid())))
 with check(workspace_id in(select workspace_id from public.workspace_members where user_id=(select auth.uid())));
alter table public.tasks add column owner_contact_id uuid;
alter table public.tasks add constraint tasks_owner_workspace foreign key(workspace_id,owner_contact_id) references public.workspace_contacts(workspace_id,id) on delete restrict;
create index tasks_owner_idx on public.tasks(workspace_id,owner_contact_id);
alter table public.workspace_activity drop constraint workspace_activity_entity_type_check;
alter table public.workspace_activity add constraint workspace_activity_entity_type_check check(entity_type in ('artist','release','task','email','proposal','contact'));
create trigger contacts_activity after insert or update or delete on public.workspace_contacts for each row execute function public.record_workspace_change('contact');
create function public.assign_task_owner(p_workspace uuid,p_task uuid,p_version integer,p_owner uuid) returns void
language plpgsql security definer set search_path='' as $$
declare t public.tasks%rowtype;
begin
 if auth.uid() is null or not exists(select 1 from public.workspace_members where workspace_id=p_workspace and user_id=auth.uid()) then raise exception 'Access denied' using errcode='42501'; end if;
 select * into t from public.tasks where workspace_id=p_workspace and id=p_task for update;
 if not found then raise exception 'Task unavailable' using errcode='42501'; end if;
 if p_version is null or t.version<>p_version then raise exception 'Task changed. Reload before assigning.' using errcode='40001'; end if;
 if p_owner is not null and not exists(select 1 from public.workspace_contacts where workspace_id=p_workspace and id=p_owner) then raise exception 'Contact unavailable' using errcode='42501'; end if;
 if t.owner_contact_id is not distinct from p_owner then return; end if;
 update public.tasks set owner_contact_id=p_owner where id=t.id;
end $$;
revoke all on function public.assign_task_owner(uuid,uuid,integer,uuid) from public,anon;
grant execute on function public.assign_task_owner(uuid,uuid,integer,uuid) to authenticated;
commit;
