-- Apply after 032. Date-only deadlines are unchanged; workspace days use Central time.
begin;
alter table public.workspaces add column time_zone text not null default 'America/Chicago';
create function public.check_workspace_timezone() returns trigger language plpgsql set search_path='' as $$
begin
 if not exists(select 1 from pg_catalog.pg_timezone_names where name=new.time_zone) then raise exception 'Invalid workspace timezone';end if;
 return new;
end $$;
create trigger workspace_timezone_valid before insert or update of time_zone on public.workspaces for each row execute function public.check_workspace_timezone();
revoke all on function public.check_workspace_timezone() from public,anon,authenticated;
commit;
