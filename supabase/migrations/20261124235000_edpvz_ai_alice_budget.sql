create table public.edpvz_ai_alice_spend (
  id uuid primary key default gen_random_uuid(),
  month date not null,
  model text not null check (model in ('aliceai-llm-flash','aliceai-llm')),
  micro_rub bigint not null check (micro_rub between 0 and 68000000),
  settled boolean not null default false
);
create index edpvz_ai_alice_spend_month on public.edpvz_ai_alice_spend(month);
alter table public.edpvz_ai_alice_spend enable row level security;
revoke all on public.edpvz_ai_alice_spend from public, anon, authenticated;
grant all on public.edpvz_ai_alice_spend to service_role;

create function public.edpvz_ai_alice_reserve(p_model text)
returns uuid language plpgsql set search_path = '' as $$
declare
  current_month date := date_trunc('month', now() at time zone 'Europe/Moscow')::date;
  amount bigint := case p_model when 'aliceai-llm-flash' then 7000000 when 'aliceai-llm' then 68000000 end;
  reservation uuid;
begin
  if amount is null then return null; end if;
  perform pg_advisory_xact_lock(483559211);
  if coalesce((select sum(micro_rub) from public.edpvz_ai_alice_spend where month=current_month),0)+amount > 100000000 then
    return null;
  end if;
  insert into public.edpvz_ai_alice_spend(month,model,micro_rub) values(current_month,p_model,amount)
    returning id into reservation;
  return reservation;
end $$;

create function public.edpvz_ai_alice_settle(p_id uuid,p_input integer,p_output integer)
returns void language sql set search_path = '' as $$
  update public.edpvz_ai_alice_spend
    set micro_rub = case model
      when 'aliceai-llm-flash' then p_input::bigint*100+p_output::bigint*200
      else p_input::bigint*500+p_output::bigint*1200
    end, settled=true
    where id=p_id and not settled and p_input>0 and p_output>=0 and p_output<=1100
      and p_input <= case model when 'aliceai-llm-flash' then 65536 else 131072 end;
$$;

create function public.edpvz_ai_alice_budget()
returns jsonb language sql set search_path = '' as $$
  select jsonb_build_object('limitRub',100,'reservedOrSpentRub',coalesce(sum(micro_rub),0)/1000000.0)
  from public.edpvz_ai_alice_spend
  where month=date_trunc('month', now() at time zone 'Europe/Moscow')::date;
$$;
revoke all on function public.edpvz_ai_alice_reserve(text), public.edpvz_ai_alice_settle(uuid,integer,integer), public.edpvz_ai_alice_budget() from public, anon, authenticated;
grant execute on function public.edpvz_ai_alice_reserve(text), public.edpvz_ai_alice_settle(uuid,integer,integer), public.edpvz_ai_alice_budget() to service_role;
