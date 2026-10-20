-- Durable, opt-in Gmail release coordination. Apply after 038.
-- Mailbox evidence stays private to its manager; all external sends need approval.
begin;
create table public.coordination_runs(
 id uuid primary key default gen_random_uuid(),workspace_id uuid not null references public.workspaces(id) on delete cascade,
 user_id uuid not null references auth.users(id) on delete cascade,release_id uuid not null references public.releases(id) on delete cascade,
 connection_id uuid not null,enabled boolean not null default true,senders text[] not null check(cardinality(senders) between 1 and 20),
 demo boolean not null default true,follow_up_hours integer not null default 48 check(follow_up_hours between 1 and 336),
 page_token text,next_run_at timestamptz not null default now(),lease uuid,lease_until timestamptz,last_error text,last_synced_at timestamptz,
 created_at timestamptz not null default now(),unique(user_id,release_id,connection_id)
);
create table public.coordination_deliverables(
 id uuid primary key default gen_random_uuid(),run_id uuid not null references public.coordination_runs(id) on delete cascade,
 task_id uuid not null references public.tasks(id) on delete cascade,title text not null,due_date date,
 extensions text[] not null default '{}',status text not null default 'outstanding' check(status in('outstanding','received','verified')),
 attachment jsonb,verified_by uuid references auth.users(id),verified_at timestamptz,unique(run_id,task_id)
);
create table public.coordination_observations(
 id uuid primary key default gen_random_uuid(),run_id uuid not null references public.coordination_runs(id) on delete cascade,
 provider_id text not null,source jsonb not null,finding jsonb not null,needs_review boolean not null,
 created_at timestamptz not null default now(),unique(run_id,provider_id)
);
create table public.coordination_blockers(
 id uuid primary key default gen_random_uuid(),run_id uuid not null references public.coordination_runs(id) on delete cascade,
 deliverable_id uuid not null references public.coordination_deliverables(id) on delete cascade,
 observation_id uuid not null references public.coordination_observations(id),severity text not null check(severity in('low','medium','high')),
 summary text not null,consequence text not null,steps jsonb not null,
 status text not null check(status in('open','awaiting_review','resolved')),updated_at timestamptz not null default now(),unique(run_id,deliverable_id)
);
create table public.coordination_actions(
 id uuid primary key default gen_random_uuid(),run_id uuid not null references public.coordination_runs(id) on delete cascade,
 observation_id uuid not null references public.coordination_observations(id),deliverable_id uuid not null references public.coordination_deliverables(id),
 parent_id uuid unique references public.coordination_actions(id),recipient text not null,subject text not null,body text not null,
 thread_id text not null,message_id text not null,status text not null default 'draft' check(status in('draft','approved','sending','sent','unknown','rejected','responded','cancelled')),
 expected_task_version integer,expected_release_version integer,
 version integer not null default 1,approved_by uuid references auth.users(id),approved_at timestamptz,attempt_id uuid unique,
 provider_id text,attempted_at timestamptz,sent_at timestamptz,follow_up_at timestamptz,created_at timestamptz not null default now(),
 check(length(body) between 1 and 6000),check(length(subject) between 1 and 200)
);
create unique index coordination_first_action on public.coordination_actions(run_id,observation_id,deliverable_id) where parent_id is null;
create table public.coordination_events(
 id bigint generated always as identity primary key,run_id uuid not null references public.coordination_runs(id) on delete cascade,
 kind text not null,description text not null,created_at timestamptz not null default now()
);
create index coordination_due on public.coordination_runs(next_run_at) where enabled;
create index coordination_actions_run on public.coordination_actions(run_id,status);
create index coordination_events_run on public.coordination_events(run_id,id desc);
create function public.coordination_access(i uuid) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.coordination_runs c join public.releases r on r.id=c.release_id and r.workspace_id=c.workspace_id
 where c.id=i and c.user_id=auth.uid() and public.workspace_role(c.workspace_id) in('owner','manager') and public.can_access_artist(c.workspace_id,r.artist_id))
$$;
-- Background work rechecks current membership/assignment and original mailbox.
create function public.coordination_active(i uuid) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.coordination_runs c
 join public.releases r on r.id=c.release_id and r.workspace_id=c.workspace_id and r.archived_at is null
 join public.artists a on a.record_id=r.artist_id and a.workspace_id=c.workspace_id and a.archived_at is null
 join public.workspace_members m on m.workspace_id=c.workspace_id and m.user_id=c.user_id and m.role in('owner','manager')
 join public.gmail_connections g on g.workspace_id=c.workspace_id and g.user_id=c.user_id and g.connection_id=c.connection_id
 where c.id=i and c.enabled and (m.role='owner' or exists(select 1 from public.artist_access aa where aa.workspace_id=c.workspace_id and aa.artist_id=r.artist_id and aa.user_id=c.user_id)))
$$;
do $$ declare t text;begin
 foreach t in array array['coordination_runs','coordination_deliverables','coordination_observations','coordination_blockers','coordination_actions','coordination_events'] loop
 execute format('alter table public.%I enable row level security',t);
 execute format('revoke all on public.%I from public,anon,authenticated',t);
 execute format('grant select on public.%I to authenticated',t);
 if exists(select 1 from pg_roles where rolname='service_role') then execute format('grant all on public.%I to service_role',t);end if;
 execute format('create policy private_coordination on public.%I for select to authenticated using(public.coordination_access(%s))',t,case when t='coordination_runs' then 'id' else 'run_id' end);
 end loop;
end $$;
create function public.configure_coordination(w uuid,r uuid,senders text[],demo boolean,hours integer) returns uuid language plpgsql security definer set search_path='' as $$
declare project public.releases%rowtype;connection uuid;s text;i uuid;begin
 select * into project from public.releases where id=r and workspace_id=w and archived_at is null;
 if not found or coalesce(public.workspace_role(w),'viewer') not in('owner','manager') or not public.can_access_artist(w,project.artist_id) then raise exception 'Manager access required' using errcode='42501';end if;
 if senders is null or cardinality(senders) not between 1 and 20 or hours is null or hours not between 1 and 336 or demo is null then raise exception 'Invalid coordination settings';end if;
 foreach s in array senders loop if s is null or length(s)>254 or s!~ '^[A-Za-z0-9.!#$%&''*+/=?^_`{|}~-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$' then raise exception 'Use exact single email addresses';end if;end loop;
 select connection_id into connection from public.gmail_connections where workspace_id=w and user_id=auth.uid();
 if connection is null then raise exception 'Connect Gmail first';end if;
 update public.coordination_runs set enabled=false where workspace_id=w and user_id=auth.uid() and release_id=r and connection_id<>connection;
 insert into public.coordination_runs(workspace_id,user_id,release_id,connection_id,senders,demo,follow_up_hours)
 values(w,auth.uid(),r,connection,array(select distinct lower(trim(v)) from unnest(senders) v),demo,hours)
 on conflict(user_id,release_id,connection_id) do update set enabled=true,senders=excluded.senders,demo=excluded.demo,follow_up_hours=excluded.follow_up_hours,next_run_at=now(),lease=null,lease_until=null
 returning id into i;
 insert into public.coordination_deliverables(run_id,task_id,title,due_date)
 select i,id,title,due_date from public.tasks where workspace_id=w and release_id=r and archived_at is null and status<>'Complete' on conflict do nothing;
 insert into public.coordination_events(run_id,kind,description) values(i,'configured','Manager enabled coordination for selected stakeholder addresses.');return i;
end $$;
create function public.pause_coordination(i uuid) returns void language plpgsql security definer set search_path='' as $$
begin if not public.coordination_access(i) then raise exception 'Access denied' using errcode='42501';end if;
 update public.coordination_runs set enabled=false,lease=null,lease_until=null where id=i;
 update public.coordination_actions set status='draft',approved_at=null,approved_by=null,version=version+1 where run_id=i and status='approved';
 insert into public.coordination_events(run_id,kind,description) values(i,'paused','Manager paused coordination. Queued approvals require review again.');end $$;
create function public.review_coordination_action(i uuid,v integer,body text,approve boolean) returns void language plpgsql security definer set search_path='' as $$
declare a public.coordination_actions%rowtype;begin
 select * into a from public.coordination_actions where id=i for update;
 if not found or not public.coordination_access(a.run_id) then raise exception 'Access denied' using errcode='42501';end if;
 if a.status<>'draft' or a.version is distinct from v or body is null or length(trim(body)) not between 1 and 6000 or approve is null then raise exception 'Draft changed. Reload and review.' using errcode='40001';end if;
 if approve and not exists(select 1 from public.coordination_deliverables d join public.tasks t on t.id=d.task_id join public.coordination_runs c on c.id=a.run_id join public.releases r on r.id=c.release_id where d.id=a.deliverable_id and t.version=a.expected_task_version and r.version=a.expected_release_version and t.status<>'Complete' and t.archived_at is null) then raise exception 'Task or project changed. Reject this draft and review a new proposal.' using errcode='40001';end if;
 if approve and not public.coordination_active(a.run_id) then raise exception 'Reconnect the original mailbox and enable coordination';end if;
 update public.coordination_actions set body=trim(review_coordination_action.body),status=case when approve then 'approved' else 'rejected' end,version=version+1,approved_by=auth.uid(),approved_at=case when approve then now() end where id=i;
 insert into public.coordination_events(run_id,kind,description) values(a.run_id,case when approve then 'approved' else 'rejected' end,case when approve then 'Manager approved the exact email draft for sending.' else 'Manager rejected the email draft.' end);
end $$;
create function public.verify_coordination_deliverable(i uuid,accept boolean) returns void language plpgsql security definer set search_path='' as $$
declare d public.coordination_deliverables%rowtype;begin
 select * into d from public.coordination_deliverables where id=i for update;
 if not found or not public.coordination_access(d.run_id) then raise exception 'Access denied' using errcode='42501';end if;
 if d.status<>'received' or d.attachment is null or accept is null then raise exception 'Review a received attachment first';end if;
 update public.coordination_deliverables set status=case when accept then 'verified' else 'outstanding' end,verified_by=case when accept then auth.uid() end,verified_at=case when accept then now() end where id=i;
 update public.coordination_blockers set status=case when accept then 'resolved' else 'open' end,updated_at=now() where run_id=d.run_id and deliverable_id=i;
 update public.coordination_actions set status='cancelled' where run_id=d.run_id and deliverable_id=i and status in('draft','approved');
 insert into public.coordination_events(run_id,kind,description) values(d.run_id,case when accept then 'verified' else 'verification_rejected' end,case when accept then 'Manager verified the received deliverable; blocker resolved.' else 'Manager rejected the received deliverable; blocker remains open.' end);
end $$;
create function public.set_coordination_requirements(i uuid,extensions text[]) returns void language plpgsql security definer set search_path='' as $$
declare d public.coordination_deliverables%rowtype;begin
 select * into d from public.coordination_deliverables where id=i for update;
 if not found or not public.coordination_access(d.run_id) then raise exception 'Access denied' using errcode='42501';end if;
 if d.status<>'outstanding' or extensions is null or cardinality(extensions)>8 or exists(select 1 from unnest(extensions) v where v is null or v not in('wav','mp3','flac','pdf','png','jpg','jpeg')) then raise exception 'Choose supported file requirements for an outstanding deliverable';end if;
 update public.coordination_deliverables set extensions=set_coordination_requirements.extensions where id=i;
 insert into public.coordination_events(run_id,kind,description) values(d.run_id,'requirements','Manager updated file requirements. Human verification is required.');end $$;
-- Durable worker lease. A crashed scan resumes; sending claims never expire into a retry.
create function public.claim_coordination() returns setof public.coordination_runs language plpgsql security definer set search_path='' as $$
begin return query with chosen as (select id from public.coordination_runs where enabled and next_run_at<=now() and (lease_until is null or lease_until<now()) and public.coordination_active(id) order by next_run_at for update skip locked limit 1)
 update public.coordination_runs c set lease=gen_random_uuid(),lease_until=now()+interval '4 minutes',next_run_at=now()+interval '5 minutes' from chosen where c.id=chosen.id returning c.*;end $$;
create function public.finish_coordination(i uuid,l uuid,token text,problem text) returns void language plpgsql security definer set search_path='' as $$
begin update public.coordination_runs set page_token=case when problem is null then token else page_token end,last_error=problem,last_synced_at=case when problem is null then now() else last_synced_at end,lease=null,lease_until=null,next_run_at=now()+case when problem is null then interval '1 minute' else interval '5 minutes' end where id=i and lease=l;end $$;
create function public.commit_coordination(i uuid,l uuid,s jsonb,f jsonb) returns void language plpgsql security definer set search_path='' as $$
declare c public.coordination_runs%rowtype;d public.coordination_deliverables%rowtype;o uuid;late boolean;received boolean;begin
 select * into c from public.coordination_runs where id=i and lease=l and lease_until>now() for update;
 if not found or not public.coordination_active(i) then raise exception 'Coordination access or lease changed';end if;
 if not (s->>'sender'=any(c.senders)) then raise exception 'Sender outside approved scope';end if;
 insert into public.coordination_observations(run_id,provider_id,source,finding,needs_review) values(i,s->>'id',s,f,f->>'kind'='ambiguous') on conflict do nothing returning id into o;
 if o is null then return;end if;
 if f->>'kind' in('ambiguous','unrelated') then
 if f->>'kind'='ambiguous' then insert into public.coordination_events(run_id,kind,description) values(i,'needs_review','Email classification is ambiguous; no actions were created.');end if;return;end if;
 if (f->>'project_id')::uuid<>c.release_id then return;end if;
 select * into d from public.coordination_deliverables where id=(f->>'deliverable_id')::uuid and run_id=i for update;
 if not found or d.status='verified' then return;end if;
 -- Backfill/late pages cannot overwrite newer observations for the same deliverable.
 if exists(select 1 from public.coordination_observations where run_id=i and id<>o and finding->>'deliverable_id'=d.id::text and (source->>'received')::timestamptz>(s->>'received')::timestamptz) then return;end if;
 update public.coordination_actions set status='responded' where run_id=i and thread_id=s->>'thread' and recipient=s->>'sender' and status='sent' and sent_at<(s->>'received')::timestamptz;
 update public.coordination_actions set status='cancelled' where run_id=i and deliverable_id=d.id and status in('draft','approved');
 select t.due_date into d.due_date from public.tasks t where t.id=d.task_id;
 update public.coordination_deliverables set due_date=d.due_date where id=d.id;
 late:= d.due_date is not null and nullif(f->>'promised_date','')::date>d.due_date;
 received:=f->>'kind'='received' and jsonb_array_length(coalesce(f->'verified_candidates','[]'))>0;
 if received then update public.coordination_deliverables set status='received',attachment=(f->'verified_candidates'->0)||jsonb_build_object('message',s->>'id','connection',c.connection_id) where id=d.id;end if;
 if late or f->>'kind' in('delay','question','received') then
 insert into public.coordination_blockers(run_id,deliverable_id,observation_id,severity,summary,consequence,steps,status)
 values(i,d.id,o,f->>'severity',f->>'summary',f->>'consequence',f->'steps',case when received then 'awaiting_review' else 'open' end)
 on conflict(run_id,deliverable_id) do update set observation_id=o,severity=excluded.severity,summary=excluded.summary,consequence=excluded.consequence,steps=excluded.steps,status=excluded.status,updated_at=now();
 if not received and length(trim(f->>'draft'))>0 and length(s->>'messageId')>0 then
 insert into public.coordination_actions(run_id,observation_id,deliverable_id,recipient,subject,body,thread_id,message_id)
 values(i,o,d.id,s->>'sender',s->>'subject',f->>'draft',s->>'thread',s->>'messageId');
 update public.coordination_actions set expected_task_version=(select version from public.tasks where id=d.task_id),expected_release_version=(select version from public.releases where id=c.release_id) where observation_id=o and run_id=i;end if;
 end if;
 insert into public.coordination_events(run_id,kind,description) values(i,case when received then 'received' else 'analyzed' end,case when received then 'Candidate attachment received; metadata matched. Human verification is still required.' else f->>'summary' end);
end $$;
create function public.claim_coordination_send(i uuid,l uuid,a uuid) returns public.coordination_actions language plpgsql security definer set search_path='' as $$
declare saved public.coordination_actions%rowtype;c public.coordination_runs%rowtype;begin
 select * into c from public.coordination_runs where id=i and lease=l and lease_until>now() for update;
 if not found or not public.coordination_active(i) then raise exception 'Lease or permission changed';end if;
 update public.coordination_actions x set status='sending',attempt_id=gen_random_uuid(),attempted_at=now()
 where x.id=a and x.run_id=i and x.status='approved' and x.approved_by=c.user_id and x.approved_at>now()-interval '24 hours'
 and x.recipient=any(c.senders) and exists(select 1 from public.gmail_connections g where g.connection_id=c.connection_id and g.user_id=c.user_id and g.can_send)
 and exists(select 1 from public.coordination_deliverables d join public.tasks t on t.id=d.task_id and t.workspace_id=c.workspace_id and t.release_id=c.release_id where d.id=x.deliverable_id and d.run_id=i and d.status='outstanding' and t.archived_at is null and t.status<>'Complete' and t.version=x.expected_task_version and exists(select 1 from public.releases r where r.id=c.release_id and r.version=x.expected_release_version))
 returning x.* into saved;
 if saved.id is not null then insert into public.coordination_events(run_id,kind,description) values(i,'sending','Approved email claimed for one send attempt.');end if;return saved;
end $$;
create function public.record_coordination_send(a uuid,attempt uuid,provider text) returns void language plpgsql security definer set search_path='' as $$
declare saved public.coordination_actions%rowtype;hours integer;begin
 select * into saved from public.coordination_actions where id=a and attempt_id=attempt for update;
 if not found or saved.status not in('sending','unknown') then return;end if;
 select follow_up_hours into hours from public.coordination_runs where id=saved.run_id;
 update public.coordination_actions set status=case when provider is null then 'unknown' when exists(select 1 from public.coordination_observations o where o.run_id=saved.run_id and o.source->>'thread'=saved.thread_id and o.source->>'sender'=saved.recipient and (o.source->>'received')::timestamptz>saved.attempted_at) then 'responded' else 'sent' end,provider_id=provider,sent_at=case when provider is not null then saved.attempted_at end,follow_up_at=case when provider is not null then now()+make_interval(hours=>hours) end where id=a;
 insert into public.coordination_events(run_id,kind,description) values(saved.run_id,case when provider is null then 'send_uncertain' else 'sent' end,case when provider is null then 'Email outcome uncertain. Check Gmail Sent; automatic resend is blocked.' else 'Gmail accepted the approved email. Monitoring the original thread.' end);end $$;
create function public.prepare_coordination_followups(i uuid,l uuid) returns void language plpgsql security definer set search_path='' as $$
declare a public.coordination_actions%rowtype;begin
 if not exists(select 1 from public.coordination_runs where id=i and lease=l and lease_until>now()) or not public.coordination_active(i) then raise exception 'Lease changed';end if;
 for a in update public.coordination_actions x set status='cancelled',version=version+1
 where x.run_id=i and x.status in('draft','approved') and not exists(
 select 1 from public.coordination_deliverables d join public.tasks t on t.id=d.task_id
 join public.coordination_runs c on c.id=d.run_id join public.releases r on r.id=c.release_id
 where d.id=x.deliverable_id and d.run_id=i and d.status='outstanding' and t.archived_at is null
 and t.status<>'Complete' and t.version=x.expected_task_version and r.version=x.expected_release_version)
 returning x.* loop
 insert into public.coordination_events(run_id,kind,description) values(i,'cancelled','A proposed email was cancelled because its task, project or deliverable changed. New stakeholder evidence is needed before another proposal.');
 end loop;
 update public.coordination_actions set status='draft',approved_by=null,approved_at=null,version=version+1 where run_id=i and status='approved' and approved_at<=now()-interval '24 hours';
 for a in select x.* from public.coordination_actions x join public.coordination_deliverables d on d.id=x.deliverable_id where x.run_id=i and x.status='sent' and x.follow_up_at<now() and d.status='outstanding' and not exists(select 1 from public.coordination_actions child where child.parent_id=x.id) loop
 if a.parent_id is null then
 insert into public.coordination_actions(run_id,observation_id,deliverable_id,parent_id,recipient,subject,body,thread_id,message_id)
 values(i,a.observation_id,a.deliverable_id,a.id,a.recipient,a.subject,'Following up on my previous message. Could you please confirm the delivery status and the earliest available delivery date?',a.thread_id,'<'||a.attempt_id||'@dopio.local>') on conflict do nothing;
 update public.coordination_actions set expected_task_version=(select t.version from public.tasks t join public.coordination_deliverables d on d.task_id=t.id where d.id=a.deliverable_id),expected_release_version=(select r.version from public.releases r join public.coordination_runs c on c.release_id=r.id where c.id=i) where parent_id=a.id and status='draft';
 insert into public.coordination_events(run_id,kind,description) values(i,'follow_up','No response within the configured window. A follow-up draft awaits approval.');
 else
 update public.coordination_actions set follow_up_at=null where id=a.id;
 insert into public.coordination_events(run_id,kind,description) values(i,'escalation','The approved follow-up has no response. Manager intervention is required.');
 end if;end loop;end $$;
-- Explicit function grants: no user can invoke worker transitions or write state directly.
revoke all on function public.coordination_access(uuid),public.configure_coordination(uuid,uuid,text[],boolean,integer),public.pause_coordination(uuid),public.review_coordination_action(uuid,integer,text,boolean),public.verify_coordination_deliverable(uuid,boolean),public.set_coordination_requirements(uuid,text[]) from public,anon;
grant execute on function public.coordination_access(uuid),public.configure_coordination(uuid,uuid,text[],boolean,integer),public.pause_coordination(uuid),public.review_coordination_action(uuid,integer,text,boolean),public.verify_coordination_deliverable(uuid,boolean),public.set_coordination_requirements(uuid,text[]) to authenticated;
revoke all on function public.coordination_active(uuid),public.claim_coordination(),public.finish_coordination(uuid,uuid,text,text),public.commit_coordination(uuid,uuid,jsonb,jsonb),public.claim_coordination_send(uuid,uuid,uuid),public.record_coordination_send(uuid,uuid,text),public.prepare_coordination_followups(uuid,uuid) from public,anon,authenticated;
do $$ begin if exists(select 1 from pg_roles where rolname='service_role') then grant execute on function public.coordination_active(uuid),public.claim_coordination(),public.finish_coordination(uuid,uuid,text,text),public.commit_coordination(uuid,uuid,jsonb,jsonb),public.claim_coordination_send(uuid,uuid,uuid),public.record_coordination_send(uuid,uuid,text),public.prepare_coordination_followups(uuid,uuid) to service_role;end if;end $$;
commit;
