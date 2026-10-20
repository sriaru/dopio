-- Apply after 019. Conflicts, archiving, current-message checks and date consistency.
begin;
alter table public.workspace_contacts add column version integer not null default 1;
create trigger contact_version before update on public.workspace_contacts for each row execute function public.bump_task_version();
alter table public.artists add column version integer not null default 1;
alter table public.releases add column version integer not null default 1;
create trigger artist_version before update on public.artists for each row execute function public.bump_task_version();
create trigger release_version before update on public.releases for each row execute function public.bump_task_version();
alter table public.artists add column archived_at timestamptz;
alter table public.releases add column archived_at timestamptz;
alter table public.tasks add column archived_at timestamptz;

create function public.archive_workspace_record(p_workspace uuid,p_kind text,p_id uuid,p_version integer,p_archive boolean) returns void
language plpgsql security definer set search_path='' as $$
declare target text; key text; changed integer;
begin
 if not exists(select 1 from public.workspace_members where workspace_id=p_workspace and user_id=auth.uid()) then raise exception 'Access denied' using errcode='42501'; end if;
 target:=case p_kind when 'artist' then 'artists' when 'release' then 'releases' when 'task' then 'tasks' end;
 if target is null or p_archive is null then raise exception 'Invalid record'; end if;
 key:=case p_kind when 'artist' then 'record_id' else 'id' end;
 execute format('update public.%I set archived_at=$1 where workspace_id=$2 and %I=$3 and version=$4',target,key)
 using case when p_archive then now() else null end,p_workspace,p_id,p_version;
 get diagnostics changed=row_count;
 if changed<>1 then raise exception 'Record changed. Reload before archiving.' using errcode='40001'; end if;
end $$;
revoke all on function public.archive_workspace_record(uuid,text,uuid,integer,boolean) from public,anon;
grant execute on function public.archive_workspace_record(uuid,text,uuid,integer,boolean) to authenticated;

-- Deferred so a reviewed release revision can move tasks and release in either order.
create function public.check_release_task_dates() returns trigger language plpgsql security definer set search_path='' as $$
declare rid uuid; wid uuid;
begin
 if TG_TABLE_NAME='releases' then rid:=new.id; else rid:=new.release_id; end if;wid:=new.workspace_id;
 if rid is not null and exists(
 select 1 from public.tasks t join public.releases r on r.workspace_id=t.workspace_id and r.id=t.release_id
 where r.workspace_id=wid and r.id=rid and r.archived_at is null and t.archived_at is null
 and t.status<>'Complete' and t.due_date>r.release_date) then
 raise exception 'An open task is after the release date. Review the release and task dates together.' using errcode='23514';
 end if;
 return null;
end $$;
create constraint trigger task_date_consistency after insert or update on public.tasks deferrable initially deferred for each row execute function public.check_release_task_dates();
create constraint trigger release_date_consistency after insert or update on public.releases deferrable initially deferred for each row execute function public.check_release_task_dates();
revoke all on function public.check_release_task_dates() from public,anon,authenticated;

create function public.task_email_snapshot(p_workspace uuid,p_task uuid) returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('version',t.version,'title',t.title,'date',t.due_date,'status',t.status,
 'archived',t.archived_at,'artist',a.name,'artist_archived',a.archived_at,'release',r.title,'release_archived',r.archived_at,
 'owner',c.id,'owner_name',c.name,'owner_email',c.email)
 from public.tasks t left join public.artists a on a.workspace_id=t.workspace_id and a.record_id=t.artist_id
 left join public.releases r on r.workspace_id=t.workspace_id and r.id=t.release_id
 left join public.workspace_contacts c on c.workspace_id=t.workspace_id and c.id=t.owner_contact_id
 where t.workspace_id=p_workspace and t.id=p_task
$$;
revoke all on function public.task_email_snapshot(uuid,uuid) from public,anon,authenticated;
alter table public.task_email_drafts add column task_snapshot jsonb;
-- Older drafts intentionally have no snapshot: they must be prepared again.
create function public.capture_task_email_snapshot() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if TG_OP='INSERT' then
 new.task_snapshot:=public.task_email_snapshot(new.workspace_id,new.task_id);
 else new.task_snapshot:=old.task_snapshot;
 end if;
 return new;
end $$;
create trigger capture_draft_snapshot before insert or update on public.task_email_drafts for each row execute function public.capture_task_email_snapshot();
revoke all on function public.capture_task_email_snapshot() from public,anon,authenticated;

create or replace function public.claim_task_email_send(p_workspace uuid,p_draft uuid,p_version integer,p_connection uuid,p_attempt uuid) returns boolean
language plpgsql security definer set search_path='' as $$
declare d public.task_email_drafts%rowtype; current_snapshot jsonb;
begin
 if not exists(select 1 from public.workspace_members where workspace_id=p_workspace and user_id=auth.uid()) then raise exception 'Access denied' using errcode='42501'; end if;
 perform pg_advisory_xact_lock(hashtextextended(p_workspace::text,15));
 perform pg_advisory_xact_lock(hashtextextended(p_draft::text,13));
 select * into d from public.task_email_drafts where workspace_id=p_workspace and id=p_draft for update;
 if not found or p_version is null or d.version<>p_version then raise exception 'Draft changed. Review again.' using errcode='40001'; end if;
 perform 1 from public.tasks where workspace_id=p_workspace and id=d.task_id for update;
 current_snapshot:=public.task_email_snapshot(p_workspace,d.task_id);
 if d.task_snapshot is null or d.task_snapshot is distinct from current_snapshot or current_snapshot->>'status'='Complete'
 or current_snapshot->>'archived' is not null or current_snapshot->>'artist_archived' is not null or current_snapshot->>'release_archived' is not null then
 raise exception 'Task, owner or project changed. Prepare a fresh draft before sending.' using errcode='40001'; end if;
 if not exists(select 1 from public.gmail_connections where workspace_id=p_workspace and user_id=auth.uid() and connection_id=p_connection and can_send) then raise exception 'Reconnect Gmail with send access'; end if;
 if exists(select 1 from public.task_email_sends s join public.task_email_drafts old on old.id=s.draft_id
 where s.workspace_id=p_workspace and old.task_id=d.task_id and lower(trim(old.recipient))=lower(trim(d.recipient))
 and regexp_replace(lower(old.subject),'[^[:alnum:]]','','g')=regexp_replace(lower(d.subject),'[^[:alnum:]]','','g')
 and regexp_replace(lower(old.body),'[^[:alnum:]]','','g')=regexp_replace(lower(d.body),'[^[:alnum:]]','','g')) then return false; end if;
 insert into public.task_email_sends(draft_id,workspace_id,actor_id,attempt_id,status) values(p_draft,p_workspace,auth.uid(),p_attempt,'sending') on conflict(draft_id) do nothing;
 return found;
end $$;
create function public.review_task_email_snapshot(p_workspace uuid,p_task uuid) returns jsonb language plpgsql security definer set search_path='' as $$
begin
 if not exists(select 1 from public.workspace_members where workspace_id=p_workspace and user_id=auth.uid()) then raise exception 'Access denied' using errcode='42501'; end if;
 return public.task_email_snapshot(p_workspace,p_task);
end $$;
create function public.save_task_email_draft_v2(p_workspace uuid,p_id uuid,p_task uuid,p_version integer,p_recipient text,p_subject text,p_body text,p_snapshot jsonb) returns integer language plpgsql security definer set search_path='' as $$
begin
 if not exists(select 1 from public.workspace_members where workspace_id=p_workspace and user_id=auth.uid()) then raise exception 'Access denied' using errcode='42501'; end if;
 perform 1 from public.tasks where workspace_id=p_workspace and id=p_task for update;
 if p_snapshot is null or p_snapshot is distinct from public.task_email_snapshot(p_workspace,p_task) then raise exception 'Task changed. Prepare a fresh draft.' using errcode='40001'; end if;
 return public.save_task_email_draft(p_workspace,p_id,p_task,p_version,p_recipient,p_subject,p_body);
end $$;
revoke all on function public.review_task_email_snapshot(uuid,uuid),public.save_task_email_draft_v2(uuid,uuid,uuid,integer,text,text,text,jsonb) from public,anon;
grant execute on function public.review_task_email_snapshot(uuid,uuid),public.save_task_email_draft_v2(uuid,uuid,uuid,integer,text,text,text,jsonb) to authenticated;
commit;
