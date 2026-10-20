-- Apply after 027. Tasks inherit the managers assigned to their artist.
-- Contact recipients remain separate; this does not send messages or change access.
begin;
create function public.task_managers(p_workspace uuid)
returns table(task_id uuid,manager_names text[])
language sql stable security definer set search_path='' as $$
 select t.id,coalesce(array_agg(coalesce(nullif(trim(p.full_name),''),'Assigned manager') order by aa.user_id)
   filter(where aa.user_id is not null),'{}'::text[])
 from public.tasks t
 left join public.releases r on r.id=t.release_id and r.workspace_id=t.workspace_id
 left join public.artist_access aa on aa.workspace_id=t.workspace_id
   and aa.artist_id=coalesce(t.artist_id,r.artist_id)
   and exists(select 1 from public.workspace_members m where m.workspace_id=aa.workspace_id and m.user_id=aa.user_id and m.role in ('owner','manager','member'))
 left join public.profiles p on p.id=aa.user_id
 where t.workspace_id=p_workspace and public.workspace_role(p_workspace) is not null
   and public.can_access_task(p_workspace,t.id)
 group by t.id
$$;
revoke all on function public.task_managers(uuid) from public,anon;
grant execute on function public.task_managers(uuid) to authenticated;
commit;
