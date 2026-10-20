-- Apply after 035. Reuse artist updates as the Messages destination.
begin;
alter table public.artist_updates add column record_version integer;
create unique index artist_update_record_event on public.artist_updates(workspace_id,kind,record_id,record_version) where kind in ('task','release');
create or replace function public.record_artist_date_update() returns trigger language plpgsql security definer set search_path='' as $$
declare aid uuid;previous date;current_value date;k text;
begin
 k:=case when TG_TABLE_NAME='tasks' then 'task' else 'release' end;
 previous:=(to_jsonb(old)->>case when k='task' then 'due_date' else 'release_date' end)::date;
 current_value:=(to_jsonb(new)->>case when k='task' then 'due_date' else 'release_date' end)::date;
 if previous is not distinct from current_value then return new;end if;
 aid:=new.artist_id;
 if aid is null and k='task' then select artist_id into aid from public.releases where id=new.release_id and workspace_id=new.workspace_id;end if;
 if aid is not null then
 insert into public.artist_updates(workspace_id,artist_id,actor_id,kind,body,record_id,record_version,previous_date,new_date)
 values(new.workspace_id,aid,auth.uid(),k,new.title,new.id,new.version,previous,current_value)
 on conflict(workspace_id,kind,record_id,record_version) where kind in ('task','release') do nothing;
 end if;
 return new;
end $$;
-- Hosted Supabase has this publication. Local test databases may not.
do $$ begin
 if exists(select 1 from pg_publication where pubname='supabase_realtime') and not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='artist_updates') then
 alter publication supabase_realtime add table public.artist_updates;
 end if;
end $$;
commit;
