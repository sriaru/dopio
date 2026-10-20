-- Apply after 022. Private saved source briefs survive navigation and sign-in.
begin;
create table public.onboarding_drafts(
 workspace_id uuid not null references public.workspaces(id) on delete cascade,
 user_id uuid not null references auth.users(id) on delete cascade,
 notes text not null check(char_length(notes)<=30000),roster text not null default '' check(char_length(roster)<=1010),
 version integer not null default 1,updated_at timestamptz not null default now(),primary key(workspace_id,user_id)
);
alter table public.onboarding_drafts enable row level security;
revoke all on public.onboarding_drafts from public,anon,authenticated;
grant select on public.onboarding_drafts to authenticated;
create policy own_source_brief on public.onboarding_drafts for select to authenticated using(user_id=auth.uid() and public.workspace_role(workspace_id) is not null);
create function public.save_onboarding_draft(p_workspace uuid,p_version integer,p_notes text,p_roster text) returns integer language plpgsql security definer set search_path='' as $$
declare v integer;
begin
 if coalesce(public.workspace_role(p_workspace),'viewer')='viewer' then raise exception 'Editor access required' using errcode='42501'; end if;
 perform pg_advisory_xact_lock(hashtextextended(p_workspace::text||auth.uid()::text,23));
 select version into v from public.onboarding_drafts where workspace_id=p_workspace and user_id=auth.uid();
 if p_version is distinct from coalesce(v,0) then raise exception 'Saved brief changed. Load it before saving.' using errcode='40001'; end if;
 v:=coalesce(v,0)+1;
 insert into public.onboarding_drafts values(p_workspace,auth.uid(),p_notes,p_roster,v,now()) on conflict(workspace_id,user_id) do update set notes=excluded.notes,roster=excluded.roster,version=excluded.version,updated_at=excluded.updated_at;
 return v;
end $$;
revoke all on function public.save_onboarding_draft(uuid,integer,text,text) from public,anon;
grant execute on function public.save_onboarding_draft(uuid,integer,text,text) to authenticated;
commit;
