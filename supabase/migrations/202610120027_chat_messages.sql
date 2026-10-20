-- Apply after 026. Durable, private chat emails with a single send attempt.
begin;
create table public.chat_messages (
 id uuid primary key,workspace_id uuid not null references public.workspaces(id) on delete cascade,
 user_id uuid not null references auth.users(id),recipient text not null,subject text not null,body text not null,
 version integer not null default 1,status text not null default 'draft' check(status in ('draft','sending','sent','unknown')),
 attempt_id uuid unique,provider_id text,updated_at timestamptz not null default now()
);
alter table public.chat_messages enable row level security;
revoke all on public.chat_messages from public,anon,authenticated;
grant select on public.chat_messages to authenticated;
create policy private_chat_messages on public.chat_messages for select to authenticated using(public.workspace_role(workspace_id) is not null and (user_id=auth.uid() or public.workspace_role(workspace_id)='owner'));
create function public.save_chat_message(w uuid,i uuid,v integer,recipient text,subject text,body text) returns integer language plpgsql security definer set search_path='' as $$
declare d public.chat_messages%rowtype;
begin
 if coalesce(public.workspace_role(w),'viewer')='viewer' then raise exception 'Editor required' using errcode='42501'; end if;
 if i is null or v is null or recipient is null or length(recipient)>254 or recipient !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' or subject is null or length(trim(subject)) not between 1 and 200 or subject ~ E'[\r\n]' or body is null or length(trim(body)) not between 1 and 6000 then raise exception 'Invalid message'; end if;
 perform pg_advisory_xact_lock(hashtextextended(i::text,27));
 select * into d from public.chat_messages where id=i for update;
 if found then
 if d.workspace_id<>w or d.user_id<>auth.uid() or d.status<>'draft' or d.version<>v then raise exception 'Message changed or locked' using errcode='40001'; end if;
 update public.chat_messages set recipient=save_chat_message.recipient,subject=save_chat_message.subject,body=save_chat_message.body,version=d.version+1,updated_at=now() where id=i;
 return d.version+1;
 end if;
 if v<>0 then raise exception 'Message unavailable'; end if;
 insert into public.chat_messages(id,workspace_id,user_id,recipient,subject,body) values(i,w,auth.uid(),recipient,subject,body);
 return 1;
end $$;
create function public.claim_chat_message(w uuid,i uuid,v integer,a uuid) returns boolean language plpgsql security definer set search_path='' as $$
declare d public.chat_messages%rowtype;
begin
 if public.workspace_role(w) is null or public.workspace_role(w) not in ('owner','manager') then raise exception 'Manager required' using errcode='42501'; end if;
 perform pg_advisory_xact_lock(hashtextextended(w::text,27));
 select * into d from public.chat_messages where workspace_id=w and user_id=auth.uid() and id=i for update;
 if not found or d.status<>'draft' or d.version is distinct from v then return false; end if;
 if exists(select 1 from public.chat_messages c where c.workspace_id=w and c.status<>'draft' and lower(trim(c.recipient))=lower(trim(d.recipient)) and trim(c.subject)=trim(d.subject) and replace(trim(c.body),E'\r\n',E'\n')=replace(trim(d.body),E'\r\n',E'\n')) then return false; end if;
 update public.chat_messages set status='sending',attempt_id=a where id=i;
 return true;
end $$;
create function public.finish_chat_message(w uuid,a uuid,p text) returns void language plpgsql security definer set search_path='' as $$
begin
 if public.workspace_role(w) is null then raise exception 'Access denied'; end if;
 update public.chat_messages set status=case when p is null then 'unknown' else 'sent' end,provider_id=p where workspace_id=w and user_id=auth.uid() and attempt_id=a and status='sending';
end $$;
revoke all on function public.save_chat_message(uuid,uuid,integer,text,text,text),public.claim_chat_message(uuid,uuid,integer,uuid),public.finish_chat_message(uuid,uuid,text) from public,anon;
grant execute on function public.save_chat_message(uuid,uuid,integer,text,text,text),public.claim_chat_message(uuid,uuid,integer,uuid),public.finish_chat_message(uuid,uuid,text) to authenticated;
commit;
