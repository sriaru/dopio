-- Read-only: run in the Supabase SQL Editor for the project used by Dopio.
-- This is a diagnostic, NOT a migration. It changes no data or permissions.
-- Shows exact workspace IDs, owner membership, archived status and assigned team.
select w.id as workspace_id, w.name as workspace_name,
       owner_profile.full_name as workspace_owner,
       owner_member.role as owner_membership_role,
       a.record_id as artist_id, a.name as artist_name, a.archived_at,
       coalesce((select string_agg(coalesce(p.full_name,'Unnamed member'), ', ')
         from public.artist_access aa
         join public.workspace_members m on m.workspace_id=aa.workspace_id and m.user_id=aa.user_id
         left join public.profiles p on p.id=aa.user_id
         where aa.workspace_id=w.id and aa.artist_id=a.record_id),'No explicit assignments') as assigned_team
from public.workspaces w
left join public.profiles owner_profile on owner_profile.id=w.owner_id
left join public.workspace_members owner_member on owner_member.workspace_id=w.id and owner_member.user_id=w.owner_id
left join public.artists a on a.workspace_id=w.id
order by w.name,w.id,a.name;

-- Confirms the access function actually installed in this database.
select pg_get_functiondef('public.can_access_artist(uuid,uuid)'::regprocedure);
