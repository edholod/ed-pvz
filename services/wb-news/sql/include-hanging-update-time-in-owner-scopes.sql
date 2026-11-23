do $migration$
declare
  definition text;
  previous_scopes constant text := 'cross join (values (''legacy''), (''new'')) as source(namespace)';
  previous_key constant text := ''':tickets:'' || source.namespace';
begin
  definition := pg_get_functiondef('public.edpvz_dispute_owner_access(text,text,text,uuid)'::regprocedure);
  if strpos(definition, previous_scopes) = 0 or strpos(definition, previous_key) = 0 then
    raise exception 'Expected WB owner sync scopes were not found';
  end if;
  execute replace(replace(definition, previous_scopes,
    'cross join (values ('':tickets:legacy''), ('':tickets:new''), ('':hanging:to-hold'')) as source(suffix)'),
    previous_key, 'source.suffix');
end
$migration$;
