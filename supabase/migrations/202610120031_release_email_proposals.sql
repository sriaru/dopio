-- Durable email-to-release approvals. No automatic task changes or external calls.
begin;
create table public.release_email_proposals(
 id uuid primary key default gen_random_uuid(),
 workspace_id uuid not null references public.workspaces(id) on delete cascade,
 message_id uuid not null,
 release_id uuid not null references public.releases(id) on delete cascade,
 release_title text not null,artist_name text not null,
 previous_date date, proposed_date date not null check(proposed_date between '1900-01-01' and '2199-12-31'),
 expected_version integer not null,evidence text not null,
 status text not null default 'pending' check(status in ('pending','approved','rejected','conflict')),
 result text not null default '', decided_at timestamptz,decided_by uuid references auth.users(id),
 created_at timestamptz not null default now(),
 unique(workspace_id,message_id),
 foreign key(workspace_id,message_id) references public.inbox_messages(workspace_id,id) on delete cascade
);
alter table public.release_email_proposals enable row level security;
revoke all on public.release_email_proposals from public,anon,authenticated;
grant select on public.release_email_proposals to authenticated;
create policy release_email_read on public.release_email_proposals for select to authenticated using(
 public.workspace_role(workspace_id) is not null and public.can_access_message(workspace_id,message_id)
 and exists(select 1 from public.releases r where r.id=release_email_proposals.release_id and r.workspace_id=release_email_proposals.workspace_id and public.can_access_artist(r.workspace_id,r.artist_id))
);
create function public.propose_email_release(p_workspace uuid,p_message uuid,p_release uuid,p_version integer,p_date date,p_evidence text)
returns uuid language plpgsql security definer set search_path='' as $$
declare m public.inbox_messages%rowtype;r public.releases%rowtype; artist text; saved uuid;
begin
 if coalesce(public.workspace_role(p_workspace),'viewer')='viewer' or not public.can_access_message(p_workspace,p_message) then raise exception 'Access denied' using errcode='42501';end if;
 select * into m from public.inbox_messages where workspace_id=p_workspace and id=p_message for update;
 if not found then raise exception 'Email unavailable';end if;
 select * into r from public.releases where workspace_id=p_workspace and id=p_release for update;
 if not found or r.archived_at is not null or not public.can_access_artist(p_workspace,r.artist_id) then raise exception 'Release unavailable' using errcode='42501';end if;
 select name into artist from public.artists where workspace_id=p_workspace and record_id=r.artist_id and archived_at is null;
 if artist is null then raise exception 'Artist unavailable';end if;
 select id into saved from public.release_email_proposals where workspace_id=p_workspace and message_id=p_message;
 if found then return saved;end if;
 if p_version is distinct from r.version then raise exception 'Release changed. Analyze again.' using errcode='40001';end if;
 if p_date is null or p_date not between '1900-01-01'::date and '2199-12-31'::date or p_evidence is null or length(trim(p_evidence)) not between 1 and 20000 or position(p_evidence in m.body)=0 then raise exception 'Invalid source evidence';end if;
 if exists(select 1 from public.deadline_proposals where message_id=p_message) then raise exception 'This email already has a task proposal';end if;
 insert into public.release_email_proposals(workspace_id,message_id,release_id,release_title,artist_name,previous_date,proposed_date,expected_version,evidence)
 values(p_workspace,p_message,p_release,r.title,artist,r.release_date,p_date,r.version,p_evidence) returning id into saved;
 update public.inbox_messages set analysis_status='proposal',analysis_note='Release date proposal prepared. Review the source and approve before any date changes.',gmail_analysis_version=gmail_analysis_version+1 where id=p_message;
 insert into public.workspace_activity(workspace_id,actor_id,entity_type,entity_id,action,title,current_data)
 values(p_workspace,auth.uid(),'proposal',saved,'created','Release date proposal: '||r.title,jsonb_build_object('message_id',m.id,'release_id',r.id,'proposed_date',p_date,'status','pending'));
 return saved;
end $$;
create function public.decide_email_release(p_workspace uuid,p_id uuid,p_approve boolean)
returns text language plpgsql security definer set search_path='' as $$
declare p public.release_email_proposals%rowtype;r public.releases%rowtype;outcome text;note text;
begin
 if public.workspace_role(p_workspace) is null or public.workspace_role(p_workspace) not in ('owner','manager') or p_approve is null then raise exception 'Manager approval required' using errcode='42501';end if;
 select * into p from public.release_email_proposals where workspace_id=p_workspace and id=p_id for update;
 if not found or not public.can_access_message(p_workspace,p.message_id) then raise exception 'Proposal unavailable' using errcode='42501';end if;
 select * into r from public.releases where workspace_id=p_workspace and id=p.release_id for update;
 if not found or not public.can_access_artist(p_workspace,r.artist_id) then raise exception 'Release unavailable' using errcode='42501';end if;
 if p.status<>'pending' then return p.status;end if;
 if not p_approve then outcome:='rejected';note:='Rejected. No dates changed.';
 elsif r.version<>p.expected_version or r.release_date is distinct from p.previous_date or r.archived_at is not null or exists(select 1 from public.artists where record_id=r.artist_id and archived_at is not null) then
 outcome:='conflict';note:='Release changed since review. No dates changed. Review the current release before preparing another change.';
 else
 perform 1 from public.tasks where workspace_id=p_workspace and release_id=r.id order by id for update;
 if exists(select 1 from public.tasks where workspace_id=p_workspace and release_id=r.id and archived_at is null and status<>'Complete' and due_date>p.proposed_date) then
 outcome:='conflict';note:='An open task falls after the proposed release. No dates changed. Review the task schedule in the release planner.';
 else
 if r.release_date is distinct from p.proposed_date then update public.releases set release_date=p.proposed_date where id=r.id;end if;
 outcome:='approved';note:='Release date saved. Task dates unchanged. Calendar sync and team messages require separate review; neither has been executed by this approval.';
 end if;
 end if;
 update public.release_email_proposals set status=outcome,result=note,decided_at=now(),decided_by=auth.uid() where id=p.id;
 insert into public.workspace_activity(workspace_id,actor_id,entity_type,entity_id,action,title,previous_data,current_data)
 values(p_workspace,auth.uid(),'proposal',p.id,outcome,'Release email decision: '||p.release_title,
 jsonb_build_object('date',p.previous_date,'message_id',p.message_id),
 jsonb_build_object('status',outcome,'result',note,'release_id',r.id,'date',case when outcome='approved' then p.proposed_date else r.release_date end,'message_id',p.message_id));
 return outcome;
end $$;
revoke all on function public.propose_email_release(uuid,uuid,uuid,integer,date,text),public.decide_email_release(uuid,uuid,boolean) from public,anon;
grant execute on function public.propose_email_release(uuid,uuid,uuid,integer,date,text),public.decide_email_release(uuid,uuid,boolean) to authenticated;
commit;
