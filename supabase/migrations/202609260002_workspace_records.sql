-- Run AFTER 202609260001_workspace_auth.sql. No sample data is inserted.
-- record_id keeps this compatible with existing artist IDs (UUID or numeric).
begin;
alter table public.artists add column record_id uuid not null default gen_random_uuid();
alter table public.artists add constraint artists_record_id_key unique(record_id);
alter table public.artists add constraint artists_workspace_record_key unique(workspace_id,record_id);
alter table public.artists add constraint artists_name_valid check(char_length(trim(name)) between 1 and 100) not valid;
alter table public.artists add constraint artists_status_valid check(status in ('Active','On Hold')) not valid;

create table public.releases (
 id uuid primary key default gen_random_uuid(),
 workspace_id uuid not null references public.workspaces(id) on delete cascade,
 artist_id uuid not null,
 title text not null check(char_length(trim(title)) between 1 and 150),
 format text not null default 'Single' check(format in ('Single','EP','Album')),
 release_date date check(release_date between '1900-01-01'::date and '2199-12-31'::date),
 status text not null default 'Planning' check(status in ('Planning','On track','At risk','Released')),
 notes text not null default '' check(char_length(notes)<=5000),
 created_at timestamptz not null default now(),
 unique(workspace_id,id),unique(workspace_id,id,artist_id),
 foreign key(workspace_id,artist_id) references public.artists(workspace_id,record_id) on delete restrict
);
create table public.tasks (
 id uuid primary key default gen_random_uuid(),
 workspace_id uuid not null references public.workspaces(id) on delete cascade,
 artist_id uuid,
 release_id uuid,
 title text not null check(char_length(trim(title)) between 1 and 150),
 due_date date check(due_date between '1900-01-01'::date and '2199-12-31'::date),
 status text not null default 'Pending' check(status in ('Pending','In progress','Complete')),
 priority text not null default 'Normal' check(priority in ('Normal','High')),
 notes text not null default '' check(char_length(notes)<=5000),
 created_at timestamptz not null default now(),
 check(release_id is null or artist_id is not null),
 foreign key(workspace_id,artist_id) references public.artists(workspace_id,record_id) on delete restrict,
 foreign key(workspace_id,release_id,artist_id) references public.releases(workspace_id,id,artist_id) on delete restrict
);
create table public.workspace_activity (
 id uuid primary key default gen_random_uuid(),
 sequence bigint generated always as identity unique,
 workspace_id uuid not null references public.workspaces(id) on delete cascade,
 actor_id uuid references auth.users(id) on delete set null,
 entity_type text not null check(entity_type in ('artist','release','task')),
 entity_id uuid not null,
 action text not null check(action in ('created','updated','deleted')),
 title text not null,
 created_at timestamptz not null default now()
);
create index releases_workspace_date_idx on public.releases(workspace_id,release_date);
create index tasks_workspace_due_idx on public.tasks(workspace_id,due_date);
create index tasks_release_idx on public.tasks(workspace_id,release_id);
create index tasks_artist_idx on public.tasks(workspace_id,artist_id);
create index releases_artist_idx on public.releases(workspace_id,artist_id);
create index activity_workspace_created_idx on public.workspace_activity(workspace_id,sequence desc);
alter table public.releases enable row level security;
alter table public.tasks enable row level security;
alter table public.workspace_activity enable row level security;
revoke all on public.releases,public.tasks,public.workspace_activity from anon,authenticated;
grant select,delete on public.releases,public.tasks to authenticated;
grant select on public.workspace_activity to authenticated;
grant insert(workspace_id,artist_id,title,format,release_date,status,notes),update(artist_id,title,format,release_date,status,notes) on public.releases to authenticated;
grant insert(workspace_id,artist_id,release_id,title,due_date,status,priority,notes),update(artist_id,release_id,title,due_date,status,priority,notes) on public.tasks to authenticated;
-- Remove broad column-write grants from the first migration.
revoke insert,update on public.artists from authenticated;
grant insert(workspace_id,name,genre,status),update(name,genre,status) on public.artists to authenticated;
-- Existing artist tables may have serial numeric IDs rather than UUID IDs.
do $$ declare sequence_name text; begin
 sequence_name:=pg_get_serial_sequence('public.artists','id');
 if sequence_name is not null then execute format('grant usage on sequence %s to authenticated',sequence_name); end if;
end $$;
create policy releases_member_access on public.releases for all to authenticated
 using(workspace_id in (select workspace_id from public.workspace_members where user_id=(select auth.uid())))
 with check(workspace_id in (select workspace_id from public.workspace_members where user_id=(select auth.uid())));
create policy tasks_member_access on public.tasks for all to authenticated
 using(workspace_id in (select workspace_id from public.workspace_members where user_id=(select auth.uid())))
 with check(workspace_id in (select workspace_id from public.workspace_members where user_id=(select auth.uid())));
create policy activity_member_read on public.workspace_activity for select to authenticated
 using(workspace_id in (select workspace_id from public.workspace_members where user_id=(select auth.uid())));

-- Append activity in the same transaction as the actual change. Clients cannot
-- forge or edit audit records. SQL-editor imports have a null (administrator) actor.
create function public.record_workspace_change() returns trigger language plpgsql security definer set search_path='' as $$
declare item jsonb; workspace uuid; item_id uuid;
begin
 if TG_OP='UPDATE' and NEW is not distinct from OLD then return NEW; end if;
 if TG_OP='DELETE' then item:=to_jsonb(OLD); else item:=to_jsonb(NEW); end if;
 workspace:=(item->>'workspace_id')::uuid;
 if workspace is not null then
 item_id:=coalesce(item->>'record_id',item->>'id')::uuid;
 insert into public.workspace_activity(workspace_id,actor_id,entity_type,entity_id,action,title)
 values(workspace,auth.uid(),TG_ARGV[0],item_id,case TG_OP when 'INSERT' then 'created' when 'UPDATE' then 'updated' else 'deleted' end,coalesce(item->>'name',item->>'title'));
 end if;
 if TG_OP='DELETE' then return OLD; else return NEW; end if;
end;
$$;
revoke all on function public.record_workspace_change() from public,anon,authenticated;
create trigger artists_activity after insert or update or delete on public.artists for each row execute function public.record_workspace_change('artist');
create trigger releases_activity after insert or update or delete on public.releases for each row execute function public.record_workspace_change('release');
create trigger tasks_activity after insert or update or delete on public.tasks for each row execute function public.record_workspace_change('task');
commit;
