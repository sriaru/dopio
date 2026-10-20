-- Apply after 029. Update the system-generated note for future chat plans.
-- Preserve privacy wrappers and historical records.
begin;
do $$ declare definition text;
begin
 select pg_get_functiondef(to_regprocedure('public.private26_create_chat_release_plan(uuid,uuid,uuid,text,text,text,date,jsonb,text)')) into definition;
 if definition is null then raise exception 'Apply migration 026 before the Dopio branding update.'; end if;
 execute replace(definition,'Created from a reviewed AURA chat plan.','Created from a reviewed Dopio chat plan.');
end $$;
commit;
