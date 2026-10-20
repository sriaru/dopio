-- Apply after 024. Enforce archive roles and handle project/archived-task dates consistently.
begin;

create or replace function public.archive_workspace_record(p_workspace uuid,p_kind text,p_id uuid,p_version integer,p_archive boolean) returns void
language plpgsql security definer set search_path='' as $$
declare target text; key text; changed integer;
begin
 if coalesce(public.workspace_role(p_workspace),'viewer') not in ('owner','manager') then raise exception 'A workspace owner or manager must archive or restore work' using errcode='42501'; end if;
 target:=case p_kind when 'artist' then 'artists' when 'release' then 'releases' when 'task' then 'tasks' end;
 if target is null or p_archive is null then raise exception 'Invalid record'; end if;
 key:=case p_kind when 'artist' then 'record_id' else 'id' end;
 execute format('update public.%I set archived_at=$1 where workspace_id=$2 and %I=$3 and version=$4',target,key)
 using case when p_archive then now() else null end,p_workspace,p_id,p_version;
 get diagnostics changed=row_count;
 if changed<>1 then raise exception 'Record changed. Reload before archiving.' using errcode='40001'; end if;
end $$;

create or replace function public.check_release_task_dates() returns trigger language plpgsql security definer set search_path='' as $$
declare rid uuid; wid uuid;
begin
 if TG_TABLE_NAME='releases' then rid:=new.id; else rid:=new.release_id; end if;wid:=new.workspace_id;
 if rid is not null and exists(
 select 1 from public.tasks t join public.releases r on r.workspace_id=t.workspace_id and r.id=t.release_id
 where r.workspace_id=wid and r.id=rid and r.archived_at is null and t.archived_at is null
 and r.format in ('Single','EP','Album') and t.status<>'Complete' and t.due_date>r.release_date) then
 raise exception 'An open task is after the release date. Review the release and task dates together.' using errcode='23514';
 end if;
 return null;
end $$;

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
    if task_date not between '1900-01-01'::date and '2199-12-31'::date or (r->>'format' in ('Single','EP','Album') and coalesce(task->>'status','Pending')<>'Complete' and task_date>release_date) then raise exception 'Task is after release'; end if;
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

create or replace function public.revise_release_plan(p_workspace uuid,p_request uuid,p_release uuid,p_expected jsonb,p_title text,p_format text,p_date date,p_tasks jsonb)
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
 if not found or r.archived_at is not null or exists(select 1 from public.artists where workspace_id=p_workspace and record_id=r.artist_id and archived_at is not null) then raise exception 'Release unavailable' using errcode='42501'; end if;
 if p_expected is distinct from jsonb_build_object('title',r.title,'format',r.format,'date',r.release_date,'artist_id',r.artist_id) then raise exception 'Release changed. Draft again.' using errcode='40001'; end if;
 if p_title is null or char_length(trim(p_title)) not between 1 and 150 or p_format is null or p_format not in ('Single','EP','Album') or p_date is null or p_date not between '1900-01-01'::date and '2199-12-31'::date then raise exception 'Invalid release'; end if;
 if p_tasks is null or jsonb_typeof(p_tasks)<>'array' then raise exception 'Invalid tasks'; end if;
 if jsonb_array_length(p_tasks)>20 then raise exception 'Maximum 20 tasks'; end if;
 if (select count(distinct value->>'id') from jsonb_array_elements(p_tasks))<>jsonb_array_length(p_tasks) then raise exception 'Duplicate task'; end if;
 -- Stable locking order also covers tasks omitted from the proposed revision.
 perform 1 from public.tasks where workspace_id=p_workspace and release_id=p_release order by id for update;
 for item in select value from jsonb_array_elements(p_tasks) order by value->>'id' loop
  select * into t from public.tasks where workspace_id=p_workspace and release_id=p_release and id=(item->>'id')::uuid;
  if not found or t.archived_at is not null then raise exception 'Task unavailable' using errcode='42501'; end if;
  if t.status='Complete' or (item->>'version')::integer is distinct from t.version then raise exception 'Task changed. Draft again.' using errcode='40001'; end if;
  if jsonb_typeof(item->'title') is distinct from 'string' or char_length(trim(item->>'title')) not between 1 and 150 or not (item ? 'due_date') then raise exception 'Invalid task'; end if;
  if item->>'due_date' is not null and (item->>'due_date') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then raise exception 'Invalid date'; end if;
  task_date:=(item->>'due_date')::date;
  if task_date is not null and task_date not between '1900-01-01'::date and p_date then raise exception 'Task date is after release'; end if;
  if t.title is distinct from trim(item->>'title') or t.due_date is distinct from task_date then
   update public.tasks set title=trim(item->>'title'),due_date=task_date where id=t.id;
  end if;
 end loop;
 if exists(select 1 from public.tasks where workspace_id=p_workspace and release_id=p_release and archived_at is null and status<>'Complete' and due_date>p_date) then raise exception 'An open task is after the proposed release date'; end if;
 if r.title is distinct from trim(p_title) or r.format is distinct from p_format or r.release_date is distinct from p_date then
  update public.releases set title=trim(p_title),format=p_format,release_date=p_date where id=p_release;
 end if;
 insert into public.release_revision_requests values(p_workspace,p_request,p_release);
 return p_release;
end $$;

commit;
