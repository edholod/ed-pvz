create table public.edpvz_ai_settings (
  id boolean primary key default true check(id),
  enabled boolean not null default false,
  tickets_enabled boolean not null default true,
  groq_enabled boolean not null default true,
  gemini_enabled boolean not null default true,
  primary_provider text not null default 'groq' check(primary_provider in ('groq','gemini')),
  groq_model text not null default 'openai/gpt-oss-120b' check(groq_model in ('openai/gpt-oss-120b','openai/gpt-oss-20b')),
  gemini_model text not null default 'gemini-2.5-flash-lite' check(gemini_model in ('gemini-2.5-flash-lite','gemini-3.1-flash-lite')),
  user_daily integer not null default 10 check(user_daily between 1 and 200),
  total_daily integer not null default 100 check(total_daily between 1 and 1000)
);
insert into public.edpvz_ai_settings default values;

create table public.edpvz_ai_usage (
  user_id uuid not null,
  request_id uuid not null,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  outcome text not null default 'pending' check(outcome in ('pending','groq','gemini','unavailable')),
  attempts jsonb not null default '[]',
  tokens integer not null default 0,
  primary key(user_id,request_id)
);
create index edpvz_ai_usage_date on public.edpvz_ai_usage(started_at);
create index edpvz_ai_usage_user_date on public.edpvz_ai_usage(user_id,started_at);

create table public.edpvz_ai_cooldowns (
  provider text primary key check(provider in ('groq','gemini')),
  until_at timestamptz not null
);

alter table public.edpvz_ai_settings enable row level security;
alter table public.edpvz_ai_usage enable row level security;
alter table public.edpvz_ai_cooldowns enable row level security;
revoke all on public.edpvz_ai_settings,public.edpvz_ai_usage,public.edpvz_ai_cooldowns from public,anon,authenticated;
grant all on public.edpvz_ai_settings,public.edpvz_ai_usage,public.edpvz_ai_cooldowns to service_role;

create function public.edpvz_ai_reserve(p_user uuid,p_request uuid,p_section text)
returns text language plpgsql set search_path = '' as $$
declare settings public.edpvz_ai_settings; today timestamptz := date_trunc('day',now(),'Europe/Moscow');
begin
  perform pg_advisory_xact_lock(483559210);
  select * into settings from public.edpvz_ai_settings where id;
  if not found or not settings.enabled or p_section is distinct from 'tickets' or not settings.tickets_enabled then return 'disabled'; end if;
  if exists(select from public.edpvz_ai_usage where user_id=p_user and request_id=p_request) then return 'duplicate'; end if;
  if (select count(*) from public.edpvz_ai_usage where started_at >= today) >= settings.total_daily
    or (select count(*) from public.edpvz_ai_usage where user_id=p_user and started_at >= today) >= settings.user_daily
    or (select count(*) from public.edpvz_ai_usage where started_at >= now()-interval '1 minute') >= 12
    or (select count(*) from public.edpvz_ai_usage where outcome='pending' and started_at >= now()-interval '40 seconds') >= 3
    or exists(select from public.edpvz_ai_usage where user_id=p_user and outcome='pending' and started_at >= now()-interval '40 seconds')
  then return 'limit'; end if;
  insert into public.edpvz_ai_usage(user_id,request_id) values(p_user,p_request);
  return 'ok';
end $$;
revoke all on function public.edpvz_ai_reserve(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.edpvz_ai_reserve(uuid,uuid,text) to service_role;

create function public.edpvz_ai_stats()
returns jsonb language sql set search_path = '' as $$
  with windows(label,since) as (
    values ('Сегодня',date_trunc('day',now(),'Europe/Moscow')),
      ('7 дней',now()-interval '7 days'),('30 дней',now()-interval '30 days')
  )
  select jsonb_build_object(
    'periods',(select jsonb_agg(to_jsonb(s)) from (
      select w.label,count(u.request_id) requests,
        count(*) filter(where outcome in ('groq','gemini')) successes,
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
revoke all on function public.edpvz_ai_stats() from public,anon,authenticated;
grant execute on function public.edpvz_ai_stats() to service_role;
