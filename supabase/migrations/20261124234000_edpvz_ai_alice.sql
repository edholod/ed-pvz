alter table public.edpvz_ai_settings
  drop constraint edpvz_ai_settings_primary_provider_check,
  drop constraint edpvz_ai_settings_groq_model_check;
alter table public.edpvz_ai_settings rename column groq_enabled to alice_enabled;
alter table public.edpvz_ai_settings rename column groq_model to alice_model;

update public.edpvz_ai_settings
set primary_provider = case when primary_provider='groq' then 'alice' else primary_provider end,
    alice_model='aliceai-llm-flash', alice_enabled=false;
alter table public.edpvz_ai_settings
  alter column alice_enabled set default false,
  alter column primary_provider set default 'alice',
  alter column alice_model set default 'aliceai-llm-flash',
  add check(primary_provider in ('alice','gemini')),
  add check(alice_model in ('aliceai-llm-flash','aliceai-llm'));

alter table public.edpvz_ai_usage drop constraint edpvz_ai_usage_outcome_check;
alter table public.edpvz_ai_usage add check(outcome in ('pending','groq','alice','gemini','unavailable'));
alter table public.edpvz_ai_cooldowns drop constraint edpvz_ai_cooldowns_provider_check;
alter table public.edpvz_ai_cooldowns add check(provider in ('groq','alice','gemini'));

create or replace function public.edpvz_ai_stats()
returns jsonb language sql set search_path = '' as $$
  with windows(label,since) as (
    values ('Сегодня',date_trunc('day',now(),'Europe/Moscow')),
      ('7 дней',now()-interval '7 days'),('30 дней',now()-interval '30 days')
  )
  select jsonb_build_object(
    'periods',(select jsonb_agg(to_jsonb(s)) from (
      select w.label,count(u.request_id) requests,
        count(*) filter(where outcome in ('groq','alice','gemini')) successes,
        count(*) filter(where outcome='unavailable' or (outcome='pending' and started_at < now()-interval '40 seconds')) failures,
        coalesce(sum(tokens),0) tokens,count(*) filter(where jsonb_array_length(attempts)>1) switches
      from windows w left join public.edpvz_ai_usage u on u.started_at >= w.since
      group by w.label,w.since order by w.since desc
    ) s),
    'recent',(select coalesce(jsonb_agg(to_jsonb(r)),'[]') from (
      select started_at,outcome,attempts from public.edpvz_ai_usage order by started_at desc limit 15
    ) r)
  );
$$;
