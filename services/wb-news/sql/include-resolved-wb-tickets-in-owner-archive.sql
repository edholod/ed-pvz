do $migration$
declare
  definition text;
  active_only constant text := 'and t.status in (''Новый'', ''В работе'', ''Ожидает решения'')';
begin
  definition := pg_get_functiondef('public.edpvz_dispute_owner_access(text,text,text,uuid)'::regprocedure);
  if strpos(definition, active_only) = 0 then
    raise exception 'Expected WB owner ticket status predicate was not found';
  end if;
  execute replace(definition, active_only, '');
end
$migration$;
