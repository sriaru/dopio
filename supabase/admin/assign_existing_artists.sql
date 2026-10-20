-- Administrator-only assignment. Run the discovery queries first in SQL Editor.
-- This is separate from the migration so records are never assigned by guessing.
select w.id as workspace_id,w.name as workspace_name,u.email as owner_email
from public.workspaces w join auth.users u on u.id=w.owner_id order by w.created_at;
select id::text as legacy_artist_id,record_id,name,genre from public.artists
where workspace_id is null order by name;

-- After verifying the owner and specific artists, replace the placeholders in
-- this block and execute it separately. It aborts on stale or incorrect IDs.
/*
begin;
do $$
declare
 target_workspace uuid := 'REPLACE_WITH_YOUR_WORKSPACE_UUID';
 expected_owner_email text := 'REPLACE_WITH_YOUR_SIGN_IN_EMAIL';
 artist_ids text[] := array['REPLACE_WITH_LEGACY_ARTIST_ID'];
 changed integer;
begin
 if not exists(select 1 from public.workspaces w join auth.users u on u.id=w.owner_id where w.id=target_workspace and lower(u.email)=lower(expected_owner_email)) then
  raise exception 'Workspace and owner email do not match';
 end if;
 if cardinality(artist_ids)=0 then raise exception 'Choose specific artists'; end if;
 update public.artists set workspace_id=target_workspace
 where workspace_id is null and id::text=any(artist_ids);
 get diagnostics changed=row_count;
 if changed<>cardinality(artist_ids) then raise exception 'Some artist IDs are missing, duplicated, or already assigned; no changes committed'; end if;
end $$;
commit;
*/
