alter table public.edpvz_dispute_sync_runs add column if not exists financial_day date;
create unique index if not exists edpvz_dispute_one_financial_run_per_day
 on public.edpvz_dispute_sync_runs (owner_id, financial_day)
 where financial_day is not null;

-- A collection already attempted today counts toward today's schedule.
with existing as (
 select distinct on (r.owner_id) r.id, (now() at time zone 'Europe/Moscow')::date as day
 from public.edpvz_dispute_sync_runs r
 join public.edpvz_dispute_sync_scopes s on s.owner_id=r.owner_id
  and s.last_attempt >= r.started_at and s.last_attempt <= coalesce(r.finished_at,now())
 where (r.started_at at time zone 'Europe/Moscow')::date = (now() at time zone 'Europe/Moscow')::date
  and s.scope ~ '^wb:org[^:]+:[0-9]+:[^:]+:(withheld|paid)$'
 order by r.owner_id,r.started_at desc
)
update public.edpvz_dispute_sync_runs r set financial_day=e.day from existing e
 where r.id=e.id and not exists (
  select 1 from public.edpvz_dispute_sync_runs prior
  where prior.owner_id=r.owner_id and prior.financial_day=e.day
 );

-- The existing claim holds the owner's control-row lock. Reserve the daily
-- financial pass in that same transaction, including across worker restarts.
do $$
declare
 definition text := pg_get_functiondef('public.edpvz_dispute_sync_commit(jsonb)'::regprocedure);
 old_insert text := 'insert into public.edpvz_dispute_sync_runs(owner_id,status) values(own,''running'') returning id into run;';
 old_return text := 'return jsonb_build_object(''claimed'',true,''run_id'',run);';
begin
 if strpos(definition,old_insert)=0 or strpos(definition,old_return)=0 then
  raise exception 'Unexpected WB sync claim definition';
 end if;
 definition := replace(definition,old_insert,$claim$
 insert into public.edpvz_dispute_sync_runs(owner_id,status,financial_day)
 select own,'running',case when not exists(
  select 1 from public.edpvz_dispute_sync_runs
  where owner_id=own and financial_day=(now() at time zone 'Europe/Moscow')::date
 ) then (now() at time zone 'Europe/Moscow')::date end
 returning id into run;
 $claim$);
 definition := replace(definition,old_return,$response$
 return jsonb_build_object('claimed',true,'run_id',run,'include_financial',
  (select financial_day is not null from public.edpvz_dispute_sync_runs where id=run));
 $response$);
 execute definition;
end $$;
