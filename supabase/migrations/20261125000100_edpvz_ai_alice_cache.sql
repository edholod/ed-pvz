alter table public.edpvz_ai_settings drop constraint edpvz_ai_gemini_first;
alter table public.edpvz_ai_settings alter column primary_provider set default 'alice';
update public.edpvz_ai_settings set primary_provider='alice', alice_enabled=true, gemini_enabled=false, enabled=true where id;

create table public.edpvz_ai_template_cache (
  fingerprint text primary key,
  template_ids jsonb,
  lease uuid not null,
  expires_at timestamptz not null
);
alter table public.edpvz_ai_template_cache enable row level security;
revoke all on public.edpvz_ai_template_cache from public, anon, authenticated;
grant all on public.edpvz_ai_template_cache to service_role;
create index edpvz_ai_template_cache_expires on public.edpvz_ai_template_cache(expires_at);

create function public.edpvz_ai_claim_template(p_fingerprint text,p_lease uuid)
returns boolean language sql set search_path = '' as $$
  with claimed as (
    insert into public.edpvz_ai_template_cache(fingerprint,lease,expires_at)
    values(p_fingerprint,p_lease,now()+interval '40 seconds')
    on conflict (fingerprint) do update
      set lease=excluded.lease, template_ids=null, expires_at=excluded.expires_at
      where public.edpvz_ai_template_cache.expires_at <= now()
    returning 1
  ) select exists(select from claimed);
$$;
revoke all on function public.edpvz_ai_claim_template(text,uuid) from public, anon, authenticated;
grant execute on function public.edpvz_ai_claim_template(text,uuid) to service_role;
