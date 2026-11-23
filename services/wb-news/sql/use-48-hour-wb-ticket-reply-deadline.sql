do $migration$
declare
  definition text := pg_get_viewdef('public.edpvz_dispute_ticket_reply_state'::regclass);
  previous_interval constant text := '72:00:00';
begin
  if strpos(definition, previous_interval) = 0 then
    raise exception 'Expected 72-hour WB reply interval was not found';
  end if;
  execute 'create or replace view public.edpvz_dispute_ticket_reply_state with (security_invoker = true) as '
    || replace(definition, previous_interval, '48:00:00');
end
$migration$;
