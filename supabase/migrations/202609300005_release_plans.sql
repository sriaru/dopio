-- Run after migrations 001–004. Saves a reviewed release plan atomically.
begin;
create table public.release_plan_requests (
 workspace_id uuid not null references public.workspaces(id) on delete cascade,
 request_id uuid not null,
 release_id uuid references public.releases(id) on delete set null,
 primary key(workspace_id,request_id)
);
alter table public.release_plan_requests enable row level security;
revoke all on public.release_plan_requests from public,anon,authenticated;
create function public.create_release_plan(p_workspace uuid,p_request uuid,p_artist uuid,p_title text,p_date date,p_tasks jsonb)
returns uuid language plpgsql security definer set search_path='' as $$
declare result uuid; item jsonb; task_date date;
begin
 if auth.uid() is null or not exists(select 1 from public.workspace_members where workspace_id=p_workspace and user_id=auth.uid()) then raise exception 'Workspace access denied' using errcode='42501'; end if;
 if p_request is null then raise exception 'Request required'; end if;
 perform pg_advisory_xact_lock(hashtextextended(p_workspace::text||p_request::text,0));
 select release_id into result from public.release_plan_requests where workspace_id=p_workspace and request_id=p_request;
 if found then
  if result is null then raise exception 'This plan was already saved and its release deleted. Start a new plan.'; end if;
  return result;
 end if;
 if not exists(select 1 from public.artists where workspace_id=p_workspace and record_id=p_artist) then raise exception 'Artist not found' using errcode='42501'; end if;
 if p_title is null or char_length(trim(p_title)) not between 1 and 200 or p_date is null or p_date not between '1900-01-01'::date and '2199-12-31'::date or p_tasks is null or jsonb_typeof(p_tasks)<>'array' then raise exception 'Invalid plan'; end if;
 if jsonb_array_length(p_tasks) not between 1 and 20 then raise exception 'Add 1 to 20 tasks'; end if;
 insert into public.releases(workspace_id,artist_id,title,format,release_date,status,notes) values(p_workspace,p_artist,trim(p_title),'Single',p_date,'Planning','Created from an approved sample plan.') returning id into result;
 for item in select value from jsonb_array_elements(p_tasks) loop
  if jsonb_typeof(item->'title') is distinct from 'string' or char_length(trim(item->>'title')) not between 1 and 200 or coalesce(item->>'due_date','') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then raise exception 'Invalid task'; end if;
  task_date:=(item->>'due_date')::date;
  if task_date not between '1900-01-01'::date and p_date then raise exception 'Task dates must be on or before release'; end if;
  insert into public.tasks(workspace_id,artist_id,release_id,title,due_date,status,priority) values(p_workspace,p_artist,result,trim(item->>'title'),task_date,'Pending','Normal');
 end loop;
 insert into public.release_plan_requests values(p_workspace,p_request,result);
 return result;
end $$;
revoke all on function public.create_release_plan(uuid,uuid,uuid,text,date,jsonb) from public,anon;
grant execute on function public.create_release_plan(uuid,uuid,uuid,text,date,jsonb) to authenticated;
commit;
