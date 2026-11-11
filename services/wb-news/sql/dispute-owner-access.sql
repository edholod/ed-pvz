-- Invitation metadata is private. Only the RPCs below can read or modify it.
create schema if not exists edpvz_dispute_access;
revoke all on schema edpvz_dispute_access from public, anon, authenticated;

create table if not exists edpvz_dispute_access.invitations (
  organization_id text primary key references public.edpvz_dispute_organizations(research_id) on delete cascade,
  recipient uuid not null references public.edpvz_profiles(user_id) on delete cascade,
  code_hash bytea,
  expires_at timestamptz not null,
  redeemed_at timestamptz,
  check ((code_hash is null) = (redeemed_at is not null))
);
alter table edpvz_dispute_access.invitations enable row level security;
revoke all on edpvz_dispute_access.invitations from public, anon, authenticated;
create index if not exists dispute_invitations_recipient on edpvz_dispute_access.invitations(recipient);

create or replace function public.edpvz_dispute_manage_access(
  p_org text, p_action text, p_username text default null
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  admin constant uuid := '0f75065b-2b26-4a87-bf26-005f5a2284d4';
  target_user uuid;
  code text;
  result jsonb;
begin
  if auth.uid() is distinct from admin or not exists (
    select 1 from public.edpvz_dispute_organizations
    where research_id = p_org and owner_id = admin
  ) then
    raise exception 'access_denied' using errcode = '42501';
  end if;

  if p_action = 'revoke' then
    delete from edpvz_dispute_access.invitations where organization_id = p_org;
    return jsonb_build_object('state', 'none');
  end if;

  if p_action = 'issue' then
    select user_id into target_user from public.edpvz_profiles
    where username = btrim(p_username) and role = 'owner' and user_id <> admin;
    if target_user is null then raise exception 'owner_not_found'; end if;
    code := 'PVZ-' || upper(replace(gen_random_uuid()::text, '-', ''));
    insert into edpvz_dispute_access.invitations as i (organization_id, recipient, code_hash, expires_at)
    values (p_org, target_user, sha256(convert_to(code, 'UTF8')), now() + interval '7 days')
    on conflict (organization_id) do update set recipient = excluded.recipient,
      code_hash = excluded.code_hash, expires_at = excluded.expires_at
    where i.redeemed_at is null;
    if not found then raise exception 'access_already_active'; end if;
  elsif p_action is distinct from 'status' then
    raise exception 'unknown_action';
  end if;

  select jsonb_build_object('username', u.username, 'expires_at', i.expires_at,
    'state', case when i.redeemed_at is not null then 'active'
      when i.expires_at <= now() then 'expired' else 'pending' end)
  into result
  from edpvz_dispute_access.invitations i
  join public.edpvz_profiles u on u.user_id = i.recipient
  where i.organization_id = p_org;
  result := coalesce(result, jsonb_build_object('state', 'none'));
  if code is not null then result := result || jsonb_build_object('code', code); end if;
  return result;
end $$;

create or replace function public.edpvz_dispute_owner_access(
  p_action text, p_code text default null, p_org text default null, p_after uuid default null
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  admin constant uuid := '0f75065b-2b26-4a87-bf26-005f5a2284d4';
  uid uuid := auth.uid();
  code text;
  redeemed text;
  result jsonb;
begin
  if uid is null or not exists (
    select 1 from public.edpvz_profiles where user_id = uid and role = 'owner'
  ) then
    if p_action = 'list' and uid is not null then return '[]'::jsonb; end if;
    raise exception 'owner_account_required' using errcode = '42501';
  end if;

  if p_action = 'redeem' then
    code := upper(btrim(p_code));
    if code is null or code !~ '^PVZ-[0-9A-F]{32}$' then raise exception 'invalid_code'; end if;
    update edpvz_dispute_access.invitations i set redeemed_at = now(), code_hash = null
    from public.edpvz_dispute_organizations o
    where o.research_id = i.organization_id and o.owner_id = admin
      and i.recipient = uid and i.redeemed_at is null and i.expires_at > now()
      and i.code_hash = sha256(convert_to(code, 'UTF8'))
    returning i.organization_id into redeemed;
    if not found then raise exception 'invalid_code'; end if;
    return jsonb_build_object('organization_id', redeemed);
  end if;

  if p_action = 'list' then
    select jsonb_agg(jsonb_build_object('id', o.research_id, 'name', o.name_exact) order by o.name_exact)
    into result
    from edpvz_dispute_access.invitations i
    join public.edpvz_dispute_organizations o on o.research_id = i.organization_id
    where i.recipient = uid and i.redeemed_at is not null and o.owner_id = admin;
    return coalesce(result, '[]'::jsonb);
  end if;

  if p_action is distinct from 'read' or not exists (
    select 1 from edpvz_dispute_access.invitations i
    join public.edpvz_dispute_organizations o on o.research_id = i.organization_id
    where i.organization_id = p_org and i.recipient = uid
      and i.redeemed_at is not null and o.owner_id = admin
  ) then
    raise exception 'access_denied' using errcode = '42501';
  end if;

  select jsonb_build_object(
    'points', coalesce((
      select jsonb_agg(jsonb_build_object('id', p.wb_point_id, 'name', p.address_observed) order by p.wb_point_id)
      from public.edpvz_dispute_points p
      where p.organization_research_id = p_org and p.owner_id = admin
    ), '[]'::jsonb),
    'rows', coalesce((
      select jsonb_agg(to_jsonb(page) order by page.id) from (
        select o.id, o.wb_point_id as point_id, o.title, o.category,
          coalesce(nullif(n.sticker, ''), o.barcode) as barcode,
          coalesce(n.cost, o.amount) as amount, n.withholding_date as deadline,
          left(o.raw->>'date_label', 120) as date_label, n.status,
          coalesce(nullif(n.ticket_number, ''), left(o.raw->>'ticket_number', 40)) as ticket
        from public.edpvz_dispute_observations o
        join public.edpvz_dispute_points p on p.wb_point_id = o.wb_point_id
          and p.organization_research_id = o.organization_research_id and p.owner_id = o.owner_id
        left join public.edpvz_dispute_notes n on n.observation_id = o.id and n.owner_id = o.owner_id
        where o.owner_id = admin and o.organization_research_id = p_org
          and o.is_current and o.wb_state = 'to-hold' and o.raw->>'collection_since' = '2026-10-01'
          and (p_after is null or o.id > p_after)
          and (o.source_event_id like 'observed:v2:%' or not exists (
            select 1 from public.edpvz_dispute_observations newer
            where newer.owner_id = o.owner_id and newer.organization_research_id = o.organization_research_id
              and newer.wb_point_id = o.wb_point_id and newer.category = o.category
              and newer.barcode is not distinct from o.barcode
              and coalesce(newer.raw->>'group','') = coalesce(o.raw->>'group','')
              and coalesce(newer.raw->>'occurrence','1') = coalesce(o.raw->>'occurrence','1')
              and newer.is_current and newer.wb_state = 'to-hold'
              and newer.raw->>'collection_since' = '2026-10-01'
              and newer.source_event_id like 'observed:v2:%'
          ))
        order by o.id limit 100
      ) page
    ), '[]'::jsonb)
  ) into result;
  return result;
end $$;

revoke all on function public.edpvz_dispute_manage_access(text,text,text) from public, anon;
revoke all on function public.edpvz_dispute_owner_access(text,text,text,uuid) from public, anon;
grant execute on function public.edpvz_dispute_manage_access(text,text,text) to authenticated;
grant execute on function public.edpvz_dispute_owner_access(text,text,text,uuid) to authenticated;
