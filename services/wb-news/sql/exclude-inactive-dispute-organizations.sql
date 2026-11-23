alter table public.edpvz_dispute_organizations add column if not exists is_active boolean not null default true;

update public.edpvz_dispute_organizations
set is_active = false
where owner_id = '0f75065b-2b26-4a87-bf26-005f5a2284d4' and research_id = 'org05';

create policy dispute_active_organizations on public.edpvz_dispute_organizations
as restrictive for select to authenticated using (is_active);

do $migration$
declare
  relation text;
  definition text;
begin
  foreach relation in array array['edpvz_dispute_points','edpvz_dispute_observations','edpvz_dispute_tickets'] loop
    execute format('create policy dispute_active_organizations on public.%1$I
      as restrictive for select to authenticated using (exists (
        select 1 from public.edpvz_dispute_organizations o
        where o.owner_id = %1$I.owner_id and o.research_id = %1$I.organization_research_id and o.is_active
      ))', relation);
  end loop;

  definition := pg_get_functiondef('public.edpvz_dispute_owner_access(text,text,text,uuid)'::regprocedure);
  if strpos(definition, 'o.owner_id = admin') = 0 then
    raise exception 'Expected dispute owner organization gate is missing';
  end if;
  execute replace(definition, 'o.owner_id = admin', 'o.owner_id = admin and o.is_active');
end
$migration$;

create policy dispute_active_ticket_history on public.edpvz_dispute_ticket_messages
as restrictive for select to authenticated using (exists (
  select 1 from public.edpvz_dispute_tickets t where t.id = ticket_id and t.owner_id = edpvz_dispute_ticket_messages.owner_id
));

create policy dispute_active_observation_notes on public.edpvz_dispute_notes
as restrictive for select to authenticated using (exists (
  select 1 from public.edpvz_dispute_observations o where o.id = observation_id and o.owner_id = edpvz_dispute_notes.owner_id
));
