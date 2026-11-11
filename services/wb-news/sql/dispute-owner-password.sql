-- Shared legal-entity passwords grant the existing per-account read-only access.
create table if not exists edpvz_dispute_access.passwords (
  organization_id text primary key references public.edpvz_dispute_organizations(research_id) on delete cascade,
  password_hash text not null
);
create table if not exists edpvz_dispute_access.password_attempts (
  recipient uuid primary key references public.edpvz_profiles(user_id) on delete cascade,
  started_at timestamptz not null,
  attempts smallint not null
);
alter table edpvz_dispute_access.passwords enable row level security;
alter table edpvz_dispute_access.password_attempts enable row level security;
revoke all on edpvz_dispute_access.passwords, edpvz_dispute_access.password_attempts from public, anon, authenticated;

create or replace function public.edpvz_dispute_manage_password(
  p_org text, p_action text, p_password text default null
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  admin constant uuid := '0f75065b-2b26-4a87-bf26-005f5a2284d4';
begin
  if auth.uid() is distinct from admin or not exists (
    select 1 from public.edpvz_dispute_organizations
    where research_id = p_org and owner_id = admin
  ) then
    raise exception 'access_denied' using errcode = '42501';
  end if;

  if p_action = 'save' then
    if p_password is null or char_length(btrim(p_password)) < 12 or octet_length(p_password) > 72 then
      raise exception 'invalid_password_length';
    end if;

    -- Serialize settings changes so two legal entities cannot share a password.
    perform pg_advisory_xact_lock(9112026, 1);
    if exists (
      select 1 from edpvz_dispute_access.passwords p
      where p.organization_id <> p_org and extensions.crypt(p_password, p.password_hash) = p.password_hash
    ) then raise exception 'password_in_use'; end if;

    insert into edpvz_dispute_access.passwords(organization_id, password_hash)
    values (p_org, extensions.crypt(p_password, extensions.gen_salt('bf', 8)))
    on conflict (organization_id) do update set password_hash = excluded.password_hash;
  elsif p_action = 'remove' then
    perform pg_advisory_xact_lock(9112026, 1);
    delete from edpvz_dispute_access.passwords where organization_id = p_org;
  elsif p_action is distinct from 'status' then
    raise exception 'unknown_action';
  end if;
  return jsonb_build_object('password_set', exists (
    select 1 from edpvz_dispute_access.passwords where organization_id = p_org
  ));
end $$;

create or replace function public.edpvz_dispute_redeem_password(p_password text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  admin constant uuid := '0f75065b-2b26-4a87-bf26-005f5a2284d4';
  uid uuid := auth.uid();
  org text;
  tries smallint;
begin
  if uid is null or uid = admin or not exists (
    select 1 from public.edpvz_profiles where user_id = uid and role = 'owner'
  ) then
    raise exception 'owner_account_required' using errcode = '42501';
  end if;
  if p_password is null or char_length(btrim(p_password)) < 12 or octet_length(p_password) > 72 then
    return jsonb_build_object('error', 'invalid_password');
  end if;

  insert into edpvz_dispute_access.password_attempts as a (recipient, started_at, attempts)
  values (uid, now(), 1)
  on conflict (recipient) do update set
    attempts = case when a.started_at <= now() - interval '10 minutes' then 1 else least(a.attempts + 1, 6) end,
    started_at = case when a.started_at <= now() - interval '10 minutes' then now() else a.started_at end
  returning attempts into tries;
  if tries > 5 then return jsonb_build_object('error', 'rate_limited'); end if;

  select p.organization_id into org
  from edpvz_dispute_access.passwords p
  join public.edpvz_dispute_organizations o on o.research_id = p.organization_id
  where o.owner_id = admin and extensions.crypt(p_password, p.password_hash) = p.password_hash
  for share of p;

  if org is null then return jsonb_build_object('error', 'invalid_password'); end if;
  insert into edpvz_dispute_access.invitations as i (organization_id, recipient, code_hash, expires_at, redeemed_at)
  values (org, uid, null, now(), now())
  on conflict (organization_id, recipient) do update set
    code_hash = null, redeemed_at = coalesce(i.redeemed_at, excluded.redeemed_at);
  delete from edpvz_dispute_access.password_attempts where recipient = uid;
  return jsonb_build_object('organization_id', org);
end $$;

revoke all on function public.edpvz_dispute_manage_password(text,text,text) from public, anon;
revoke all on function public.edpvz_dispute_redeem_password(text) from public, anon;
grant execute on function public.edpvz_dispute_manage_password(text,text,text) to authenticated;
grant execute on function public.edpvz_dispute_redeem_password(text) to authenticated;
