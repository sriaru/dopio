-- Run once in the Supabase SQL Editor or via `supabase db push`.
-- Existing artists are preserved but remain unassigned until an administrator
-- explicitly associates them with the correct workspace. Never claim old data
-- automatically on signup.
begin;
create table public.profiles (
 id uuid primary key references auth.users(id) on delete cascade,
 full_name text not null check (char_length(full_name) between 1 and 100),
 role text not null default 'Artist Manager' check (role in ('Artist Manager','Publicist','Label Team','Independent Artist')),
 company text not null default '' check (char_length(company)<=150),
 artist_count text not null default '1–2' check (artist_count in ('1–2','3–5','6–10','11+')),
 onboarding_step smallint not null default 1 check (onboarding_step between 1 and 2),
 onboarding_completed_at timestamptz,
 created_at timestamptz not null default now()
);
create table public.workspaces (
 id uuid primary key default gen_random_uuid(),
 name text not null check (char_length(name) between 1 and 100),
 owner_id uuid not null references auth.users(id) on delete cascade,
 created_at timestamptz not null default now(),
 unique(owner_id)
);
create table public.workspace_members (
 workspace_id uuid not null references public.workspaces(id) on delete cascade,
 user_id uuid not null references auth.users(id) on delete cascade,
 role text not null default 'owner' check(role in ('owner','member')),
 created_at timestamptz not null default now(),
 primary key(workspace_id,user_id)
);
create index workspace_members_user_idx on public.workspace_members(user_id);
alter table public.profiles enable row level security;
alter table public.workspaces enable row level security;
alter table public.workspace_members enable row level security;
revoke all on public.profiles,public.workspaces,public.workspace_members from anon,authenticated;
grant select on public.profiles,public.workspaces,public.workspace_members to authenticated;
grant update(full_name) on public.profiles to authenticated;
create policy profiles_read_self on public.profiles for select to authenticated using(id=(select auth.uid()));
create policy profiles_update_self on public.profiles for update to authenticated using(id=(select auth.uid())) with check(id=(select auth.uid()));
create policy memberships_read_self on public.workspace_members for select to authenticated using(user_id=(select auth.uid()));
create policy workspaces_read_member on public.workspaces for select to authenticated using(id in (select workspace_id from public.workspace_members where user_id=(select auth.uid())));

-- One atomic, idempotent operation creates the profile, owned workspace, and
-- owner membership. Identity is always derived from the verified JWT.
create function public.save_workspace_onboarding(
 p_full_name text,p_role text,p_company text,p_artist_count text,p_workspace_name text,p_complete boolean default false
) returns uuid language plpgsql security definer set search_path='' as $$
declare v_user uuid:=auth.uid(); v_workspace uuid;
begin
 if v_user is null then raise exception 'Authentication required' using errcode='42501'; end if;
 if p_full_name is null or char_length(trim(p_full_name)) not between 1 and 100
 or p_workspace_name is null or char_length(trim(p_workspace_name)) not between 1 and 100
 or p_company is null or char_length(p_company)>150
 or p_role is null or p_role not in ('Artist Manager','Publicist','Label Team','Independent Artist')
 or p_artist_count is null or p_artist_count not in ('1–2','3–5','6–10','11+')
 or p_complete is null then raise exception 'Invalid onboarding details' using errcode='22023'; end if;
 -- Serialize requests for this user to avoid duplicate workspaces on retries.
 perform pg_advisory_xact_lock(hashtextextended(v_user::text,0));
 insert into public.profiles(id,full_name,role,company,artist_count,onboarding_step,onboarding_completed_at)
 values(v_user,trim(p_full_name),p_role,trim(p_company),p_artist_count,case when p_complete then 2 else 1 end,case when p_complete then now() else null end)
 on conflict(id) do update set full_name=excluded.full_name,role=excluded.role,company=excluded.company,artist_count=excluded.artist_count,
 onboarding_step=greatest(public.profiles.onboarding_step,excluded.onboarding_step),
 onboarding_completed_at=coalesce(public.profiles.onboarding_completed_at,excluded.onboarding_completed_at);
 insert into public.workspaces(name,owner_id) values(trim(p_workspace_name),v_user)
 on conflict(owner_id) do update set name=excluded.name returning id into v_workspace;
 insert into public.workspace_members(workspace_id,user_id,role) values(v_workspace,v_user,'owner') on conflict do nothing;
 return v_workspace;
end;
$$;
revoke all on function public.save_workspace_onboarding(text,text,text,text,text,boolean) from public,anon;
grant execute on function public.save_workspace_onboarding(text,text,text,text,text,boolean) to authenticated;

-- Apply a workspace boundary to the original roster, including installations
-- with earlier permissive RLS policies. The restrictive policy cannot be bypassed
-- by those older policies.
create table if not exists public.artists (
 id uuid primary key default gen_random_uuid(),
 name text not null,
 genre text,
 status text not null default 'Active',
 created_at timestamptz not null default now()
);
alter table public.artists add column workspace_id uuid references public.workspaces(id) on delete cascade;
create index artists_workspace_idx on public.artists(workspace_id);
alter table public.artists enable row level security;
revoke all on public.artists from anon;
grant select,insert,update,delete on public.artists to authenticated;
create policy artists_workspace_boundary on public.artists as restrictive for all to public
 using(workspace_id in (select workspace_id from public.workspace_members where user_id=(select auth.uid())))
 with check(workspace_id in (select workspace_id from public.workspace_members where user_id=(select auth.uid())));
create policy artists_member_access on public.artists for all to authenticated
 using(workspace_id in (select workspace_id from public.workspace_members where user_id=(select auth.uid())))
 with check(workspace_id in (select workspace_id from public.workspace_members where user_id=(select auth.uid())));
commit;
