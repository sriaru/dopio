-- Apply after 021. Projects, reviewed contacts/owners and explicitly unconfirmed timing.
begin;
alter table public.releases drop constraint releases_format_check;
alter table public.releases add constraint releases_format_check check(format in ('Single','EP','Album','Tour','Campaign','Video','Partnership','Other'));
alter table public.releases add column timing_notes text not null default '' check(char_length(timing_notes)<=1000);
alter table public.tasks add column timing_notes text not null default '' check(char_length(timing_notes)<=1000);
grant insert(timing_notes),update(timing_notes) on public.releases,public.tasks to authenticated;
create or replace function public.approve_setup_document_v2(p_workspace uuid,p_request uuid,p_artists jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare a jsonb; artist uuid; release uuid; r jsonb; task jsonb; release_date date; task_date date; contact jsonb; cid uuid; task_owner uuid; result jsonb:='[]';
begin
 if auth.uid() is null or not exists(select 1 from public.workspace_members where workspace_id=p_workspace and user_id=auth.uid()) then raise exception 'Access denied' using errcode='42501'; end if;
 if p_request is null then raise exception 'Request required'; end if;
 perform pg_advisory_xact_lock(hashtextextended(p_workspace::text,17));
 select artist_ids into result from public.setup_scan_requests where workspace_id=p_workspace and request_id=p_request;
 if found then return result; end if;
 result:='[]';
 if p_artists is null or jsonb_typeof(p_artists)<>'array' then raise exception 'Invalid artists'; end if;
 if jsonb_array_length(p_artists) not between 1 and 10 then raise exception 'Choose 1 to 10 artists'; end if;
 for a in select value from jsonb_array_elements(p_artists) order by lower(trim(value->>'name')) loop
  if jsonb_typeof(a->'name') is distinct from 'string' or char_length(trim(a->>'name')) not between 1 and 100 or jsonb_typeof(a->'genre') is distinct from 'string' or char_length(a->>'genre')>100 or jsonb_typeof(a->'context') is distinct from 'string' or char_length(a->>'context')>2500 or jsonb_typeof(a->'evidence') is distinct from 'string' or char_length(trim(a->>'evidence')) not between 1 and 1500 or jsonb_typeof(a->'source_id') is distinct from 'string' or char_length(a->>'source_id')>300 then raise exception 'Invalid artist details'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_workspace::text||lower(trim(a->>'name')),1));
  if exists(select 1 from public.artists where workspace_id=p_workspace and lower(trim(name))=lower(trim(a->>'name'))) then raise exception 'Artist already exists. Exclude it from the review.' using errcode='23505'; end if;
  insert into public.artists(workspace_id,name,genre,status) values(p_workspace,trim(a->>'name'),trim(a->>'genre'),'Active') returning record_id into artist;
  perform public.save_artist_brief(p_workspace,artist,0,'',coalesce(a->>'context','')||E'\n\nApproved setup source: '||(a->>'source_id')||E'\nSource quote: '||(a->>'evidence'),'');
  if a ? 'contacts' then
   if jsonb_typeof(a->'contacts') is distinct from 'array' or jsonb_array_length(a->'contacts')>30 then raise exception 'Invalid contacts'; end if;
   for contact in select value from jsonb_array_elements(a->'contacts') loop
    if jsonb_typeof(contact->'name') is distinct from 'string' or char_length(trim(contact->>'name')) not between 1 and 100 or jsonb_typeof(contact->'email') is distinct from 'string' or jsonb_typeof(contact->'role') is distinct from 'string' then raise exception 'Invalid contact'; end if;
    select id into cid from public.workspace_contacts where workspace_id=p_workspace and lower(email)=lower(trim(contact->>'email')) for update;
    if found then
     if exists(select 1 from public.workspace_contacts where id=cid and (lower(trim(name))<>lower(trim(contact->>'name')) or lower(trim(role))<>lower(trim(contact->>'role')))) then raise exception 'Contact details conflict with a saved contact. Review before importing.' using errcode='22023'; end if;
    else
     insert into public.workspace_contacts(workspace_id,name,email,role) values(p_workspace,trim(contact->>'name'),lower(trim(contact->>'email')),trim(contact->>'role'));
    end if;
   end loop;
  end if;
  if jsonb_typeof(a->'releases') is distinct from 'array' then raise exception 'Invalid releases'; end if;
  if jsonb_array_length(a->'releases')>5 then raise exception 'Maximum 5 releases per artist'; end if;
  for r in select value from jsonb_array_elements(a->'releases') loop
   if jsonb_typeof(r)<>'object' or jsonb_typeof(r->'title') is distinct from 'string' or char_length(trim(r->>'title')) not between 1 and 150 or coalesce(r->>'format','') not in ('Single','EP','Album','Tour','Campaign','Video','Partnership','Other') or (jsonb_typeof(r->'date') is distinct from 'string' or ((r->>'date')<>'' and (r->>'date') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$')) or jsonb_typeof(r->'tasks') is distinct from 'array' then raise exception 'Invalid release'; end if;
   if jsonb_typeof(r->'source_id') is distinct from 'string' or char_length(r->>'source_id')>300 or jsonb_typeof(r->'evidence') is distinct from 'string' or char_length(trim(r->>'evidence')) not between 1 and 1500 then raise exception 'Invalid release evidence'; end if;
   release_date:=nullif(r->>'date','')::date;
   if release_date not between '1900-01-01'::date and '2199-12-31'::date or jsonb_array_length(r->'tasks')>20 then raise exception 'Invalid release dates or tasks'; end if;
   insert into public.releases(workspace_id,artist_id,title,format,release_date,status,timing_notes,notes) values(p_workspace,artist,trim(r->>'title'),r->>'format',release_date,'Planning',coalesce(r->>'timing',''),'Approved setup source: '||(r->>'source_id')||E'\nSource quote: '||(r->>'evidence')) returning id into release;
   for task in select value from jsonb_array_elements(r->'tasks') loop
    if jsonb_typeof(task->'title') is distinct from 'string' or char_length(trim(task->>'title')) not between 1 and 150 or (jsonb_typeof(task->'due_date') is distinct from 'string' or ((task->>'due_date')<>'' and (task->>'due_date') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$')) then raise exception 'Invalid task'; end if;
    if jsonb_typeof(task->'source_id') is distinct from 'string' or char_length(task->>'source_id')>300 or jsonb_typeof(task->'evidence') is distinct from 'string' or char_length(trim(task->>'evidence')) not between 1 and 1500 then raise exception 'Invalid task evidence'; end if;
    task_date:=nullif(task->>'due_date','')::date;
    if task_date not between '1900-01-01'::date and '2199-12-31'::date or task_date>release_date then raise exception 'Task is after release'; end if;
    task_owner:=null;
    if coalesce(task->>'owner_email','')<>'' then
     if not exists(select 1 from jsonb_array_elements(a->'contacts') c where lower(c->>'email')=lower(task->>'owner_email')) then raise exception 'Task owner must be a reviewed contact'; end if;
     select id into task_owner from public.workspace_contacts where workspace_id=p_workspace and lower(email)=lower(task->>'owner_email');
     if task_owner is null then raise exception 'Task owner unavailable'; end if;
    end if;
    insert into public.tasks(workspace_id,artist_id,release_id,title,due_date,status,priority,timing_notes,owner_contact_id,notes) values(p_workspace,artist,release,trim(task->>'title'),task_date,coalesce(task->>'status','Pending'),'Normal',coalesce(task->>'timing',''),task_owner,'Approved setup source: '||(task->>'source_id')||E'\nSource quote: '||(task->>'evidence'));
   end loop;
  end loop;
  result:=result||jsonb_build_array(artist);
 end loop;
 insert into public.setup_scan_requests values(p_workspace,p_request,result);
 return result;
end $$;
revoke all on function public.approve_setup_document_v2(uuid,uuid,jsonb) from public,anon;
grant execute on function public.approve_setup_document_v2(uuid,uuid,jsonb) to authenticated;
commit;
