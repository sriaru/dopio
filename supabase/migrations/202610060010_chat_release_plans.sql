-- Apply once after 009. Approved chat plans save atomically.
begin;
create function public.create_chat_release_plan(p_workspace uuid,p_request uuid,p_artist uuid,p_name text,p_genre text,p_title text,p_date date,p_tasks jsonb,p_format text)
returns uuid language plpgsql security definer set search_path='' as $$
declare result uuid; artist uuid:=p_artist;
begin
 if auth.uid() is null or not exists(select 1 from public.workspace_members where workspace_id=p_workspace and user_id=auth.uid()) then raise exception 'Workspace access denied' using errcode='42501'; end if;
 if p_request is null then raise exception 'Request required'; end if;
 perform pg_advisory_xact_lock(hashtextextended(p_workspace::text||p_request::text,0));
 select release_id into result from public.release_plan_requests where workspace_id=p_workspace and request_id=p_request;
 if found then
  if result is null then raise exception 'Saved release was deleted. Start a new plan.'; end if;
  return result;
 end if;
 if p_name is null or char_length(trim(p_name)) not between 1 and 100 or p_genre is null or char_length(p_genre)>100 then raise exception 'Invalid artist'; end if;
 if artist is null then
  perform pg_advisory_xact_lock(hashtextextended(p_workspace::text||lower(trim(p_name)),1));
  if exists(select 1 from public.artists where workspace_id=p_workspace and lower(trim(name))=lower(trim(p_name))) then raise exception 'Artist already exists. Select that artist in the review.'; end if;
  insert into public.artists(workspace_id,name,genre,status) values(p_workspace,trim(p_name),trim(p_genre),'Active') returning record_id into artist;
 elsif not exists(select 1 from public.artists where workspace_id=p_workspace and record_id=artist) then raise exception 'Artist unavailable' using errcode='42501';
 end if;
 result:=public.create_release_plan_v2(p_workspace,p_request,artist,p_title,p_date,p_tasks,p_format);
 update public.releases set notes='Created from a reviewed AURA chat plan.' where id=result and workspace_id=p_workspace;
 return result;
end $$;
revoke all on function public.create_chat_release_plan(uuid,uuid,uuid,text,text,text,date,jsonb,text) from public,anon;
grant execute on function public.create_chat_release_plan(uuid,uuid,uuid,text,text,text,date,jsonb,text) to authenticated;
commit;
