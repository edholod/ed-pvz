create or replace function public.edpvz_ai_alice_budget()
returns jsonb language sql set search_path = '' as $$
  with period as (
    select (now() at time zone 'Europe/Moscow')::date < date '2027-01-23' as grant_active,
      date_trunc('month', now() at time zone 'Europe/Moscow')::date as current_month
  )
  select jsonb_build_object(
    'limitRub', case when p.grant_active then 4000 else 100 end,
    'reservedOrSpentRub', coalesce((
      select sum(s.micro_rub) from public.edpvz_ai_alice_spend s
      where s.month between (case when p.grant_active then date '2026-11-01' else p.current_month end)
        and p.current_month
    ),0)/1000000.0,
    'period', case when p.grant_active then 'grant' else 'month' end,
    'grantEndsOn', '2027-01-23'
  ) from period p;
$$;

create or replace function public.edpvz_ai_alice_reserve(p_model text)
returns uuid language plpgsql set search_path = '' as $$
declare
  current_month date := date_trunc('month', now() at time zone 'Europe/Moscow')::date;
  amount bigint := case p_model when 'aliceai-llm-flash' then 7000000 when 'aliceai-llm' then 68000000 end;
  budget jsonb;
  reservation uuid;
begin
  if amount is null then return null; end if;
  perform pg_advisory_xact_lock(483559211);
  budget := public.edpvz_ai_alice_budget();
  if (budget->>'reservedOrSpentRub')::numeric*1000000+amount >
    (budget->>'limitRub')::numeric*1000000 then
    return null;
  end if;
  insert into public.edpvz_ai_alice_spend(month,model,micro_rub) values(current_month,p_model,amount)
    returning id into reservation;
  return reservation;
end $$;
