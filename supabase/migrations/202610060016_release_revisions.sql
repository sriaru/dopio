-- Apply after 015. Reviewed revisions preserve task IDs, owners and history.
begin;
create table public.release_revision_requests (
 workspace_id uuid not null references public.workspaces(id) on delete cascade,
 request_id uuid not null,
 release_id uuid references public.releases(id) on delete set null,
 primary key(workspace_id,request_id)
);
alter table public.release_revision_requests enable row level security;
revoke all on public.release_revision_requests from public,anon,authenticated;
create function public.revise_release_plan(p_workspace uuid,p_request uuid,p_release uuid,p_expected jsonb,p_title text,p_format text,p_date date,p_tasks jsonb)
returns uuid language plpgsql security definer set search_path='' as $$
declare r public.releases%rowtype; t public.tasks%rowtype; item jsonb; saved uuid; task_date date;
begin
 if auth.uid() is null or not exists(select 1 from public.workspace_members where workspace_id=p_workspace and user_id=auth.uid()) then raise exception 'Access denied' using errcode='42501'; end if;
 if p_request is null then raise exception 'Request required'; end if;
 perform pg_advisory_xact_lock(hashtextextended(p_workspace::text||p_request::text,16));
 select release_id into saved from public.release_revision_requests where workspace_id=p_workspace and request_id=p_request;
 if found then
  if saved is null or saved<>p_release then raise exception 'Saved revision unavailable'; end if;
  return saved;
 end if;
 select * into r from public.releases where workspace_id=p_workspace and id=p_release for update;
 if not found then raise exception 'Release unavailable' using errcode='42501'; end if;
 if p_expected is distinct from jsonb_build_object('title',r.title,'format',r.format,'date',r.release_date,'artist_id',r.artist_id) then raise exception 'Release changed. Draft again.' using errcode='40001'; end if;
 if p_title is null or char_length(trim(p_title)) not between 1 and 150 or p_format is null or p_format not in ('Single','EP','Album') or p_date is null or p_date not between '1900-01-01'::date and '2199-12-31'::date then raise exception 'Invalid release'; end if;
 if p_tasks is null or jsonb_typeof(p_tasks)<>'array' then raise exception 'Invalid tasks'; end if;
 if jsonb_array_length(p_tasks)>20 then raise exception 'Maximum 20 tasks'; end if;
 if (select count(distinct value->>'id') from jsonb_array_elements(p_tasks))<>jsonb_array_length(p_tasks) then raise exception 'Duplicate task'; end if;
 -- Stable locking order also covers tasks omitted from the proposed revision.
 perform 1 from public.tasks where workspace_id=p_workspace and release_id=p_release order by id for update;
 for item in select value from jsonb_array_elements(p_tasks) order by value->>'id' loop
  select * into t from public.tasks where workspace_id=p_workspace and release_id=p_release and id=(item->>'id')::uuid;
  if not found then raise exception 'Task unavailable' using errcode='42501'; end if;
  if t.status='Complete' or (item->>'version')::integer is distinct from t.version then raise exception 'Task changed. Draft again.' using errcode='40001'; end if;
  if jsonb_typeof(item->'title') is distinct from 'string' or char_length(trim(item->>'title')) not between 1 and 150 or not (item ? 'due_date') then raise exception 'Invalid task'; end if;
  if item->>'due_date' is not null and (item->>'due_date') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then raise exception 'Invalid date'; end if;
  task_date:=(item->>'due_date')::date;
  if task_date is not null and task_date not between '1900-01-01'::date and p_date then raise exception 'Task date is after release'; end if;
  if t.title is distinct from trim(item->>'title') or t.due_date is distinct from task_date then
   update public.tasks set title=trim(item->>'title'),due_date=task_date where id=t.id;
  end if;
 end loop;
 if exists(select 1 from public.tasks where workspace_id=p_workspace and release_id=p_release and status<>'Complete' and due_date>p_date) then raise exception 'An open task is after the proposed release date'; end if;
 if r.title is distinct from trim(p_title) or r.format is distinct from p_format or r.release_date is distinct from p_date then
  update public.releases set title=trim(p_title),format=p_format,release_date=p_date where id=p_release;
 end if;
 insert into public.release_revision_requests values(p_workspace,p_request,p_release);
 return p_release;
end $$;
revoke all on function public.revise_release_plan(uuid,uuid,uuid,jsonb,text,text,date,jsonb) from public,anon;
grant execute on function public.revise_release_plan(uuid,uuid,uuid,jsonb,text,text,date,jsonb) to authenticated;
commit;
