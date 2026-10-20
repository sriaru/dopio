-- Apply after 020. Invitations, role enforcement, usage caps and durable audit detail.
begin;
alter table public.workspace_members drop constraint workspace_members_role_check;
alter table public.workspace_members add constraint workspace_members_role_check check(role in ('owner','manager','member','viewer'));
create function public.workspace_role(p_workspace uuid) returns text language sql stable security definer set search_path='' as $$
 select role from public.workspace_members where workspace_id=p_workspace and user_id=auth.uid()
$$;
revoke all on function public.workspace_role(uuid) from public,anon;
grant execute on function public.workspace_role(uuid) to authenticated;
create function public.guard_workspace_mutation() returns trigger language plpgsql security definer set search_path='' as $$
declare w uuid; r text;
begin
 if auth.uid() is null then return case when TG_OP='DELETE' then old else new end; end if;
 w:=case when TG_OP='DELETE' then old.workspace_id else new.workspace_id end;r:=public.workspace_role(w);
 if r is null or r='viewer' or (TG_OP='DELETE' and r not in ('owner','manager')) then raise exception 'Your workspace role cannot make this change' using errcode='42501'; end if;
 if TG_TABLE_NAME='task_email_sends' or (TG_TABLE_NAME='deadline_proposals' and TG_OP='UPDATE') then
 if r not in ('owner','manager') then raise exception 'A workspace owner or manager must approve this action' using errcode='42501'; end if;
 end if;
 return case when TG_OP='DELETE' then old else new end;
end $$;
do $$ declare t text; begin
 foreach t in array array['artists','releases','tasks','workspace_contacts','artist_briefs','task_email_drafts','task_email_sends','deadline_proposals','inbox_messages'] loop
 execute format('create trigger workspace_role_guard before insert or update or delete on public.%I for each row execute function public.guard_workspace_mutation()',t);
 end loop;
end $$;
revoke all on function public.guard_workspace_mutation() from public,anon,authenticated;

create table public.workspace_invites(
 id uuid primary key default gen_random_uuid(),workspace_id uuid not null references public.workspaces(id) on delete cascade,
 email text not null,role text not null check(role in ('manager','member','viewer')),
 token_hash text not null unique,created_at timestamptz not null default now(),expires_at timestamptz not null default now()+interval '7 days',
 accepted_at timestamptz,revoked_at timestamptz
);
alter table public.workspace_invites enable row level security;
revoke all on public.workspace_invites from public,anon,authenticated;
create function public.create_workspace_invite(p_workspace uuid,p_email text,p_role text,p_token text) returns uuid language plpgsql security definer set search_path='' as $$
declare result uuid;
begin
 if public.workspace_role(p_workspace) is distinct from 'owner' then raise exception 'Owner required' using errcode='42501'; end if;
 if p_email is null or char_length(p_email)>254 or p_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' or p_role not in ('manager','member','viewer') or p_token is null or char_length(p_token)<40 then raise exception 'Invalid invitation'; end if;
 insert into public.workspace_invites(workspace_id,email,role,token_hash) values(p_workspace,lower(trim(p_email)),p_role,encode(sha256(convert_to(p_token,'UTF8')),'hex')) returning id into result;
 return result;
end $$;
create function public.accept_workspace_invite(p_token text) returns uuid language plpgsql security definer set search_path='' as $$
declare inv public.workspace_invites%rowtype; email text;
begin
 if auth.uid() is null then raise exception 'Sign in first' using errcode='42501'; end if;
 select u.email into email from auth.users u where u.id=auth.uid();
 select * into inv from public.workspace_invites where token_hash=encode(sha256(convert_to(p_token,'UTF8')),'hex') for update;
 if not found or inv.revoked_at is not null or inv.expires_at<now() or lower(email) is distinct from inv.email then raise exception 'Invitation unavailable or email does not match' using errcode='42501'; end if;
 if inv.accepted_at is not null and not exists(select 1 from public.workspace_members where workspace_id=inv.workspace_id and user_id=auth.uid()) then raise exception 'Invitation already used'; end if;
 insert into public.workspace_members(workspace_id,user_id,role) values(inv.workspace_id,auth.uid(),inv.role) on conflict do nothing;
 update public.workspace_invites set accepted_at=coalesce(accepted_at,now()) where id=inv.id;
 return inv.workspace_id;
end $$;
create function public.manage_workspace_member(p_workspace uuid,p_user uuid,p_role text) returns void language plpgsql security definer set search_path='' as $$
begin
 if public.workspace_role(p_workspace) is distinct from 'owner' then raise exception 'Owner required' using errcode='42501'; end if;
 if exists(select 1 from public.workspaces where id=p_workspace and owner_id=p_user) then raise exception 'The owner cannot be removed or demoted'; end if;
 if p_role is null then
 delete from public.workspace_members where workspace_id=p_workspace and user_id=p_user;
 delete from public.gmail_connections where workspace_id=p_workspace and user_id=p_user;
 delete from public.calendar_connections where workspace_id=p_workspace and user_id=p_user;
 else
 if p_role not in ('manager','member','viewer') then raise exception 'Invalid role'; end if;
 update public.workspace_members set role=p_role where workspace_id=p_workspace and user_id=p_user;
 end if;
end $$;
create function public.workspace_team(p_workspace uuid) returns jsonb language plpgsql security definer set search_path='' as $$
begin
 if public.workspace_role(p_workspace) is null then raise exception 'Access denied' using errcode='42501'; end if;
 return jsonb_build_object('role',public.workspace_role(p_workspace),'members',(select coalesce(jsonb_agg(jsonb_build_object('id',m.user_id,'name',p.full_name,'email',u.email,'role',m.role)),'[]') from public.workspace_members m join auth.users u on u.id=m.user_id left join public.profiles p on p.id=m.user_id where m.workspace_id=p_workspace),
 'invites',case when public.workspace_role(p_workspace)='owner' then (select coalesce(jsonb_agg(jsonb_build_object('id',id,'email',email,'role',role,'expires',expires_at,'accepted',accepted_at,'revoked',revoked_at)),'[]') from public.workspace_invites where workspace_id=p_workspace) else '[]'::jsonb end);
end $$;
create function public.revoke_workspace_invite(p_workspace uuid,p_id uuid) returns void language plpgsql security definer set search_path='' as $$
begin
 if public.workspace_role(p_workspace) is distinct from 'owner' then raise exception 'Owner required' using errcode='42501'; end if;
 update public.workspace_invites set revoked_at=now() where workspace_id=p_workspace and id=p_id;
end $$;
revoke all on function public.create_workspace_invite(uuid,text,text,text),public.accept_workspace_invite(text),public.manage_workspace_member(uuid,uuid,text),public.workspace_team(uuid),public.revoke_workspace_invite(uuid,uuid) from public,anon;
grant execute on function public.create_workspace_invite(uuid,text,text,text),public.accept_workspace_invite(text),public.manage_workspace_member(uuid,uuid,text),public.workspace_team(uuid),public.revoke_workspace_invite(uuid,uuid) to authenticated;

create table public.workspace_ai_limits(workspace_id uuid primary key references public.workspaces(id) on delete cascade,monthly_requests integer not null default 200 check(monthly_requests between 0 and 10000));
create table public.workspace_ai_months(workspace_id uuid not null references public.workspaces(id) on delete cascade,month date not null,attempts integer not null default 0,primary key(workspace_id,month));
alter table public.workspace_ai_limits enable row level security;alter table public.workspace_ai_months enable row level security;
revoke all on public.workspace_ai_limits,public.workspace_ai_months from public,anon,authenticated;
grant select on public.workspace_ai_limits,public.workspace_ai_months to authenticated;
grant insert(workspace_id,monthly_requests),update(monthly_requests) on public.workspace_ai_limits to authenticated;
create policy ai_limit_read on public.workspace_ai_limits for select to authenticated using(public.workspace_role(workspace_id) is not null);
create policy ai_limit_insert on public.workspace_ai_limits for insert to authenticated with check(public.workspace_role(workspace_id)='owner');
create policy ai_limit_update on public.workspace_ai_limits for update to authenticated using(public.workspace_role(workspace_id)='owner') with check(public.workspace_role(workspace_id)='owner');
create policy ai_month_read on public.workspace_ai_months for select to authenticated using(public.workspace_role(workspace_id) is not null);
create or replace function public.reserve_email_analysis(p_workspace uuid) returns boolean language plpgsql security definer set search_path='' as $$
declare used integer;cap integer;period date:=date_trunc('month',now() at time zone 'UTC')::date;n integer;
begin
 if coalesce(public.workspace_role(p_workspace),'viewer')='viewer' then raise exception 'Editor access required' using errcode='42501'; end if;
 perform pg_advisory_xact_lock(hashtextextended(p_workspace::text,21));
 select monthly_requests into cap from public.workspace_ai_limits where workspace_id=p_workspace;cap:=coalesce(cap,200);
 select attempts into used from public.workspace_ai_months where workspace_id=p_workspace and month=period;
 if coalesce(used,0)>=cap then return false; end if;
 insert into public.email_ai_usage values(p_workspace,now(),1)
 on conflict(workspace_id) do update set attempts=case when public.email_ai_usage.window_start<now()-interval '1 minute' then 1 else public.email_ai_usage.attempts+1 end,window_start=case when public.email_ai_usage.window_start<now()-interval '1 minute' then now() else public.email_ai_usage.window_start end returning attempts into n;
 if n>10 then return false; end if;
 insert into public.workspace_ai_months values(p_workspace,period,1) on conflict(workspace_id,month) do update set attempts=public.workspace_ai_months.attempts+1;
 return true;
end $$;

alter table public.workspace_activity add column previous_data jsonb;
alter table public.workspace_activity add column current_data jsonb;
create or replace function public.record_workspace_change() returns trigger language plpgsql security definer set search_path='' as $$
declare item jsonb; workspace uuid; item_id uuid;
begin
 if TG_OP='UPDATE' and NEW is not distinct from OLD then return NEW; end if;
 if TG_OP='DELETE' then item:=to_jsonb(OLD); else item:=to_jsonb(NEW); end if;
 workspace:=(item->>'workspace_id')::uuid;item_id:=coalesce(item->>'record_id',item->>'id')::uuid;
 if workspace is not null then
 insert into public.workspace_activity(workspace_id,actor_id,entity_type,entity_id,action,title,previous_data,current_data)
 values(workspace,auth.uid(),TG_ARGV[0],item_id,case TG_OP when 'INSERT' then 'created' when 'UPDATE' then 'updated' else 'deleted' end,
 coalesce(item->>'name',item->>'title'),case when TG_OP<>'INSERT' then to_jsonb(OLD) end,case when TG_OP<>'DELETE' then to_jsonb(NEW) end);
 end if;
 return case when TG_OP='DELETE' then OLD else NEW end;
end $$;
-- Use the existing activity vocabulary.

commit;
