-- ONE-TIME ADMIN REPAIR, not a general migration. Run in Supabase SQL Editor.
-- Requires migrations through 036. Moves only the three reviewed artist IDs.
-- Atomic and repeatable. Keeps IDs, deadlines, statuses and conversation history.
-- Does NOT move mailboxes, emails, OAuth tokens or personal chat conversations.
begin;
set local lock_timeout='10s';
create temporary table transfer_config on commit drop as select
 '715ceb2b-a82d-4e32-8bea-95dd2e7cb057'::uuid src,
 '03cb5c5d-a424-4660-be39-f837d424e619'::uuid dst;
create temporary table transfer_artists(id uuid primary key) on commit drop;
insert into transfer_artists values
 ('acca015c-9c5f-4d3e-83b2-dcc5e9def12f'),
 ('b0b2ee1a-5e18-4726-9465-a54c90ebd0cc'),
 ('360b3003-26f7-4bfb-8218-e4e4bbeb9801');
-- Prevent concurrent writes while validating and relocating linked records.
lock table public.artists,public.releases,public.tasks,public.workspace_contacts,
 public.workspace_members,public.artist_access,public.artist_briefs,
 public.artist_updates,public.artist_update_preferences,public.deadline_proposals,
 public.release_email_proposals,public.task_email_drafts,public.calendar_connections
 in share row exclusive mode;
do $$ declare s uuid;d uuid;alex uuid;begin
 select src,dst into s,d from transfer_config;
 if auth.uid() is not null then raise exception 'Run this repair as database administrator in SQL Editor';end if;
 select owner_id into alex from public.workspaces where id=s;
 if alex is null or not exists(select 1 from public.workspaces w join public.workspace_members m on m.workspace_id=w.id and m.user_id=w.owner_id and m.role='owner' where w.id=d)
 or not exists(select 1 from public.workspace_members where workspace_id=d and user_id=alex and role='manager') then raise exception 'Verify both owners and Alex manager membership in the destination first';end if;
 if (select count(*) from public.artists where record_id in(select id from transfer_artists) and workspace_id in(s,d))<>3 then raise exception 'Expected three exact artists in the source or destination';end if;
 if exists(select 1 from public.artists a join public.artists b on b.workspace_id=d and lower(trim(b.name))=lower(trim(a.name)) and b.record_id<>a.record_id where a.record_id in(select id from transfer_artists)) then raise exception 'Destination has a duplicate artist name; review before moving';end if;
 if exists(select 1 from public.deadline_proposals where task_id in(select id from public.tasks where artist_id in(select id from transfer_artists)))
 or exists(select 1 from public.release_email_proposals where release_id in(select id from public.releases where artist_id in(select id from transfer_artists)))
 or exists(select 1 from public.task_email_drafts where task_id in(select id from public.tasks where artist_id in(select id from transfer_artists))) then raise exception 'Linked email reviews or drafts require a separate transfer review. Nothing moved.';end if;
 -- Merely connecting Google does not mean any events were synced. Leave an
 -- unused connection in place; block active, completed or uncertain syncs.
 if exists(select 1 from public.calendar_connections where workspace_id=s and
 (calendar_id is not null or creation_started or lease_until>now()))
 or exists(select 1 from public.google_calendar_runs where workspace_id=s)
 then raise exception 'Source has Calendar sync state. Run supabase/diagnostics/artist_transfer_calendar.sql before proceeding. Nothing moved.';end if;
 if exists(select 1 from public.artist_access where workspace_id=s and artist_id in(select id from transfer_artists) and user_id<>alex) then raise exception 'Additional source teammates require an access review. Nothing moved.';end if;
end $$;
create temporary table transfer_contacts on commit drop as
 select distinct owner_contact_id id from public.tasks where artist_id in(select id from transfer_artists) and owner_contact_id is not null;
do $$ begin
 if exists(select 1 from public.tasks where owner_contact_id in(select id from transfer_contacts) and (artist_id is null or artist_id not in(select id from transfer_artists))) then raise exception 'A contact is shared with other artists; review before moving';end if;
end $$;
-- Defer only relevant foreign keys until all linked workspace IDs agree. Restore
-- each original constraint setting before commit; constraints/triggers stay active.
create temporary table transfer_constraints on commit drop as
 select conrelid::regclass tbl,conname,condeferrable,condeferred from pg_constraint
 where contype='f' and confrelid in('public.artists'::regclass,'public.releases'::regclass,'public.workspace_contacts'::regclass);
do $$ declare c record;begin
 for c in select * from transfer_constraints loop
 execute format('alter table %s alter constraint %I deferrable initially deferred',c.tbl,c.conname);
 end loop;
end $$;
update public.workspace_contacts set workspace_id=(select dst from transfer_config)
 where id in(select id from transfer_contacts) and workspace_id=(select src from transfer_config);
update public.artists set workspace_id=(select dst from transfer_config)
 where record_id in(select id from transfer_artists) and workspace_id=(select src from transfer_config);
update public.releases set workspace_id=(select dst from transfer_config)
 where artist_id in(select id from transfer_artists) and workspace_id=(select src from transfer_config);
update public.tasks set workspace_id=(select dst from transfer_config)
 where artist_id in(select id from transfer_artists) and workspace_id=(select src from transfer_config);
update public.artist_briefs set workspace_id=(select dst from transfer_config)
 where artist_id in(select id from transfer_artists) and workspace_id=(select src from transfer_config);
update public.artist_updates set workspace_id=(select dst from transfer_config)
 where artist_id in(select id from transfer_artists) and workspace_id=(select src from transfer_config);
update public.artist_update_preferences set workspace_id=(select dst from transfer_config)
 where artist_id in(select id from transfer_artists) and workspace_id=(select src from transfer_config)
 and user_id in(select user_id from public.workspace_members where workspace_id=(select dst from transfer_config));
update public.artist_access set workspace_id=(select dst from transfer_config)
 where artist_id in(select id from transfer_artists) and workspace_id=(select src from transfer_config);
insert into public.artist_access(workspace_id,artist_id,user_id)
 select c.dst,a.id,w.owner_id from transfer_config c cross join transfer_artists a join public.workspaces w on w.id=c.src
 on conflict do nothing;
update public.workspace_activity set workspace_id=(select dst from transfer_config)
 where workspace_id=(select src from transfer_config) and
 ((entity_type='artist' and entity_id in(select id from transfer_artists))
 or (entity_type='release' and entity_id in(select id from public.releases where artist_id in(select id from transfer_artists)))
 or (entity_type='task' and entity_id in(select id from public.tasks where artist_id in(select id from transfer_artists)))
 or (entity_type='contact' and entity_id in(select id from transfer_contacts)));
-- Historical request receipts stay in their original workspace. They cannot
-- recreate these IDs. Versions increment normally, invalidating stale reviews.
set constraints all immediate;
do $$ declare c record;begin
 for c in select * from transfer_constraints loop
 execute format('alter table %s alter constraint %I %s',c.tbl,c.conname,
 case when c.condeferrable then 'deferrable initially '||case when c.condeferred then 'deferred' else 'immediate' end else 'not deferrable' end);
 end loop;
end $$;
commit;
select a.name,w.name as workspace_name,p.full_name as assigned_manager
 from public.artists a join public.workspaces w on w.id=a.workspace_id
 join public.artist_access aa on aa.workspace_id=a.workspace_id and aa.artist_id=a.record_id
 join public.profiles p on p.id=aa.user_id
 where a.record_id in('acca015c-9c5f-4d3e-83b2-dcc5e9def12f','b0b2ee1a-5e18-4726-9465-a54c90ebd0cc','360b3003-26f7-4bfb-8218-e4e4bbeb9801');
