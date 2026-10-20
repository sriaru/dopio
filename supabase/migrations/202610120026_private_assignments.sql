-- Apply after 025. Owner-controlled artist access; personal integrations stay private.
begin;
create table public.artist_access (
 workspace_id uuid not null references public.workspaces(id) on delete cascade,
 artist_id uuid not null references public.artists(record_id) on delete cascade,
 user_id uuid not null references auth.users(id) on delete cascade,
 primary key(workspace_id,artist_id,user_id),
 foreign key(workspace_id,user_id) references public.workspace_members(workspace_id,user_id) on delete cascade
);
alter table public.artist_access enable row level security;
revoke all on public.artist_access from public,anon,authenticated;
grant select on public.artist_access to authenticated;
create policy assignment_read on public.artist_access for select to authenticated using(public.workspace_role(workspace_id)='owner' or user_id=auth.uid());
create function public.can_access_artist(w uuid,a uuid) returns boolean language sql stable security definer set search_path='' as $$
 select coalesce(public.workspace_role(w)='owner' or (public.workspace_role(w) is not null and exists(select 1 from public.artist_access where workspace_id=w and artist_id=a and user_id=auth.uid())),false)
$$;
create function public.can_access_task(w uuid,t uuid) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.tasks where workspace_id=w and id=t and public.can_access_artist(w,artist_id) and (release_id is null or exists(select 1 from public.releases r where r.workspace_id=w and r.id=release_id and public.can_access_artist(w,r.artist_id))))
$$;
alter table public.inbox_messages add column imported_by uuid references auth.users(id) on delete set null;
alter table public.workspace_contacts add column created_by uuid references auth.users(id) on delete set null;
-- Legacy provenance is unknown: only the owner sees those rows unless a contact is assigned to visible work.
alter table public.inbox_messages alter column imported_by set default auth.uid();
alter table public.workspace_contacts alter column created_by set default auth.uid();
create function public.can_access_message(w uuid,m uuid) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.inbox_messages where workspace_id=w and id=m and (public.workspace_role(w)='owner' or (public.workspace_role(w) is not null and imported_by=auth.uid())))
$$;
create function public.can_access_contact(w uuid,c uuid) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.workspace_contacts where workspace_id=w and id=c and (public.workspace_role(w)='owner' or (public.workspace_role(w) is not null and (created_by=auth.uid() or exists(select 1 from public.tasks t where t.workspace_id=w and t.owner_contact_id=c and public.can_access_task(w,t.id))))))
$$;
create policy artist_assignment on public.artists as restrictive for all to authenticated using(public.can_access_artist(workspace_id,record_id)) with check(public.can_access_artist(workspace_id,record_id));
create policy project_assignment on public.releases as restrictive for all to authenticated using(public.can_access_artist(workspace_id,artist_id)) with check(public.can_access_artist(workspace_id,artist_id));
create policy task_assignment on public.tasks as restrictive for all to authenticated using(public.can_access_artist(workspace_id,artist_id)) with check(public.can_access_artist(workspace_id,artist_id));
create policy brief_assignment on public.artist_briefs as restrictive for all to authenticated using(public.can_access_artist(workspace_id,artist_id));
create policy private_activity on public.workspace_activity as restrictive for select to authenticated using(public.workspace_role(workspace_id)='owner');
create policy private_inbox on public.inbox_messages as restrictive for select to authenticated using(public.can_access_message(workspace_id,id));
create policy assigned_proposals on public.deadline_proposals as restrictive for select to authenticated using(public.can_access_task(workspace_id,task_id) and public.can_access_message(workspace_id,message_id));
create policy assigned_drafts on public.task_email_drafts as restrictive for select to authenticated using(public.can_access_task(workspace_id,task_id));
create policy assigned_sends on public.task_email_sends as restrictive for select to authenticated using(exists(select 1 from public.task_email_drafts d where d.workspace_id=workspace_id and d.id=draft_id));
create policy private_contacts on public.workspace_contacts as restrictive for all to authenticated using(public.workspace_role(workspace_id)='owner' or created_by=auth.uid() or public.can_access_contact(workspace_id,id)) with check(public.workspace_role(workspace_id)='owner' or created_by=auth.uid());
create function public.assign_artist_access(p_workspace uuid,p_artist uuid,p_user uuid,p_allow boolean) returns void language plpgsql security definer set search_path='' as $$
begin
 if public.workspace_role(p_workspace) is distinct from 'owner' then raise exception 'Owner required' using errcode='42501'; end if;
 if not exists(select 1 from public.artists where workspace_id=p_workspace and record_id=p_artist) or not exists(select 1 from public.workspace_members where workspace_id=p_workspace and user_id=p_user) then raise exception 'Artist or member unavailable'; end if;
 if p_allow then insert into public.artist_access values(p_workspace,p_artist,p_user) on conflict do nothing;
 else delete from public.artist_access where workspace_id=p_workspace and artist_id=p_artist and user_id=p_user; end if;
end $$;
create function public.workspace_sender_name(p_workspace uuid) returns text language plpgsql stable security definer set search_path='' as $$
begin
 if public.workspace_role(p_workspace) is null then raise exception 'Access denied' using errcode='42501'; end if;
 return (select nullif(trim(p.full_name),'') from public.workspaces w join public.profiles p on p.id=w.owner_id where w.id=p_workspace);
end $$;
-- Also guard security-definer writes, which otherwise bypass RLS.
create function public.guard_assigned_write() returns trigger language plpgsql security definer set search_path='' as $$
declare v jsonb; w uuid; ok boolean;
begin
 if auth.uid() is null then return case when TG_OP='DELETE' then old else new end; end if;
 for v in select x from unnest(case when TG_OP='UPDATE' then array[to_jsonb(old),to_jsonb(new)] when TG_OP='DELETE' then array[to_jsonb(old)] else array[to_jsonb(new)] end) x loop
 w:=(v->>'workspace_id')::uuid;
 if public.workspace_role(w)='owner' then continue; end if;
 ok:=case TG_TABLE_NAME
 when 'artists' then TG_OP<>'INSERT' and public.can_access_artist(w,(v->>'record_id')::uuid)
 when 'releases' then public.can_access_artist(w,(v->>'artist_id')::uuid)
 when 'tasks' then public.can_access_artist(w,(v->>'artist_id')::uuid) and ((v->>'release_id') is null or exists(select 1 from public.releases where workspace_id=w and id=(v->>'release_id')::uuid and public.can_access_artist(w,artist_id)))
 when 'artist_briefs' then public.can_access_artist(w,(v->>'artist_id')::uuid)
 when 'task_email_drafts' then public.can_access_task(w,(v->>'task_id')::uuid)
 when 'deadline_proposals' then public.can_access_task(w,(v->>'task_id')::uuid) and public.can_access_message(w,(v->>'message_id')::uuid)
 when 'inbox_messages' then (v->>'imported_by')::uuid=auth.uid()
 when 'workspace_contacts' then (TG_OP='INSERT' and (v->>'created_by')::uuid=auth.uid()) or public.can_access_contact(w,(v->>'id')::uuid)
 when 'task_email_sends' then exists(select 1 from public.task_email_drafts where workspace_id=w and id=(v->>'draft_id')::uuid and public.can_access_task(w,task_id))
 else false end;
 if not coalesce(ok,false) then raise exception 'Record not assigned to you' using errcode='42501'; end if;
 end loop;
 return case when TG_OP='DELETE' then old else new end;
end $$;
do $$ declare t text; begin
 foreach t in array array['artists','releases','tasks','artist_briefs','task_email_drafts','deadline_proposals','inbox_messages','workspace_contacts','task_email_sends'] loop
 execute format('create trigger assigned_write before insert or update or delete on public.%I for each row execute function public.guard_assigned_write()',t);
 end loop;
end $$;
-- Check access before any RPC reads, deduplication returns, or writes.
create function public.check_assigned_rpc(fn text,p jsonb) returns void language plpgsql security definer set search_path='' as $$
declare w uuid:=(p->>'p_workspace')::uuid; a uuid; t uuid; m uuid; d uuid; r uuid;
begin
 if auth.uid() is null then raise exception 'Access denied' using errcode='42501'; end if;
 if fn='decide_deadline_proposal' then
 select workspace_id,task_id,message_id into w,t,m from public.deadline_proposals where id=(p->>'p_id')::uuid;
 elsif fn in ('save_task_email_draft','save_task_email_draft_v2') then d:=(p->>'p_id')::uuid;
 end if;
 if public.workspace_role(w) is null then raise exception 'Access denied' using errcode='42501'; end if;
 if public.workspace_role(w)='owner' then return; end if;
 if fn in ('approve_setup_artists','approve_setup_document','approve_setup_document_v2','import_deadline_email','create_chat_release_plan') and (fn<>'create_chat_release_plan' or p->>'p_artist' is null) then raise exception 'Owner required for roster creation or legacy imports' using errcode='42501'; end if;
 a:=(p->>'p_artist')::uuid;t:=coalesce(t,(p->>'p_task')::uuid);m:=coalesce(m,(p->>'p_message')::uuid);r:=(p->>'p_release')::uuid;d:=coalesce(d,(p->>'p_draft')::uuid);
 if a is not null and not public.can_access_artist(w,a) then raise exception 'Artist unavailable' using errcode='42501'; end if;
 if t is not null and not public.can_access_task(w,t) then raise exception 'Task unavailable' using errcode='42501'; end if;
 if m is not null and not public.can_access_message(w,m) then raise exception 'Message unavailable' using errcode='42501'; end if;
 if r is not null and not exists(select 1 from public.releases where workspace_id=w and id=r and public.can_access_artist(w,artist_id)) then raise exception 'Project unavailable' using errcode='42501'; end if;
 if d is not null and exists(select 1 from public.task_email_drafts where id=d and (workspace_id<>w or not public.can_access_task(w,task_id))) then raise exception 'Draft unavailable' using errcode='42501'; end if;
 if p->>'p_owner' is not null and not public.can_access_contact(w,(p->>'p_owner')::uuid) then raise exception 'Contact unavailable' using errcode='42501'; end if;
end $$;
-- Preserve signatures; originals become inaccessible implementation functions.
do $$ declare f record; args text; callargs text; pairs text; body text; begin
 for f in select p.oid,p.proname,pg_get_function_identity_arguments(p.oid) ident,pg_get_function_arguments(p.oid) declarations,pg_get_function_result(p.oid) result,p.proargnames from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname=any(array['review_task_email_snapshot','save_task_email_draft','save_task_email_draft_v2','claim_task_email_send','save_artist_brief','assign_task_owner','create_release_plan','create_release_plan_v2','create_chat_release_plan','revise_release_plan','save_gmail_analysis','import_ai_email','import_deadline_email','decide_deadline_proposal','approve_setup_artists','approve_setup_document','approve_setup_document_v2']) loop
 select string_agg(quote_ident(x),','),string_agg(quote_literal(x)||','||quote_ident(x),',') into callargs,pairs from unnest(f.proargnames) x;
 execute format('alter function public.%I(%s) rename to %I',f.proname,f.ident,'private26_'||f.proname);
 execute format('revoke all on function public.%I(%s) from public,anon,authenticated','private26_'||f.proname,f.ident);
 body:=format('begin perform public.check_assigned_rpc(%L,jsonb_build_object(%s)); %s public.%I(%s); %s end',f.proname,pairs,case when f.result='void' then 'perform' else 'return' end,'private26_'||f.proname,callargs,case when f.result='void' then 'return;' else '' end);
 execute format('create function public.%I(%s) returns %s language plpgsql security definer set search_path='''' as %L',f.proname,f.declarations,f.result,body);
 execute format('revoke all on function public.%I(%s) from public,anon',f.proname,f.ident);
 execute format('grant execute on function public.%I(%s) to authenticated',f.proname,f.ident);
 end loop;
end $$;
revoke all on function public.check_assigned_rpc(text,jsonb),public.guard_assigned_write() from public,anon,authenticated;
revoke all on function public.can_access_artist(uuid,uuid),public.can_access_task(uuid,uuid),public.can_access_message(uuid,uuid),public.can_access_contact(uuid,uuid),public.assign_artist_access(uuid,uuid,uuid,boolean),public.workspace_sender_name(uuid) from public,anon;
grant execute on function public.can_access_artist(uuid,uuid),public.can_access_task(uuid,uuid),public.can_access_message(uuid,uuid),public.can_access_contact(uuid,uuid),public.assign_artist_access(uuid,uuid,uuid,boolean),public.workspace_sender_name(uuid) to authenticated;
create or replace function public.workspace_team(p_workspace uuid) returns jsonb language plpgsql security definer set search_path='' as $$
begin
 if public.workspace_role(p_workspace) is null then raise exception 'Access denied' using errcode='42501'; end if;
 return jsonb_build_object('role',public.workspace_role(p_workspace),'members',(select coalesce(jsonb_agg(jsonb_build_object('id',m.user_id,'name',p.full_name,'email',u.email,'role',m.role)),'[]') from public.workspace_members m join auth.users u on u.id=m.user_id left join public.profiles p on p.id=m.user_id where m.workspace_id=p_workspace and (public.workspace_role(p_workspace)='owner' or m.user_id=auth.uid())),
 'invites',case when public.workspace_role(p_workspace)='owner' then (select coalesce(jsonb_agg(jsonb_build_object('id',id,'email',email,'role',role,'expires',expires_at,'accepted',accepted_at,'revoked',revoked_at)),'[]') from public.workspace_invites where workspace_id=p_workspace) else '[]'::jsonb end);
end $$;
commit;
