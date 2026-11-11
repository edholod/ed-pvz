-- Keep every existing code and grant. The key now identifies one account within a legal entity.
alter table edpvz_dispute_access.invitations
  drop constraint invitations_pkey,
  add constraint invitations_pkey primary key (organization_id, recipient);

create or replace function public.edpvz_dispute_manage_access(
  p_org text, p_action text, p_username text default null
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  admin constant uuid := '0f75065b-2b26-4a87-bf26-005f5a2284d4';
  target_user uuid;
  code text;
  accounts jsonb;
  result jsonb;
begin
  if auth.uid() is distinct from admin or not exists (
    select 1 from public.edpvz_dispute_organizations
    where research_id = p_org and owner_id = admin
  ) then
    raise exception 'access_denied' using errcode = '42501';
  end if;

  if p_action = 'revoke' then
    if p_username is null then
      -- Cached admin pages can still revoke an unambiguous single grant.
      delete from edpvz_dispute_access.invitations where organization_id = p_org
        and (select count(*) from edpvz_dispute_access.invitations where organization_id = p_org) = 1;
      if not found and exists (
        select 1 from edpvz_dispute_access.invitations where organization_id = p_org
      ) then raise exception 'account_required'; end if;
    else
      delete from edpvz_dispute_access.invitations i
      using public.edpvz_profiles u
      where i.organization_id = p_org and u.user_id = i.recipient and u.username = btrim(p_username);
    end if;
  elsif p_action = 'issue' then
    select user_id into target_user from public.edpvz_profiles
    where username = btrim(p_username) and role = 'owner' and user_id <> admin;
    if target_user is null then raise exception 'owner_not_found'; end if;
    code := 'PVZ-' || upper(replace(gen_random_uuid()::text, '-', ''));
    insert into edpvz_dispute_access.invitations as i (organization_id, recipient, code_hash, expires_at)
    values (p_org, target_user, sha256(convert_to(code, 'UTF8')), now() + interval '7 days')
    on conflict (organization_id, recipient) do update set
      code_hash = excluded.code_hash, expires_at = excluded.expires_at
    where i.redeemed_at is null;
    if not found then raise exception 'access_already_active'; end if;
  elsif p_action is distinct from 'status' then
    raise exception 'unknown_action';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'username', u.username, 'expires_at', i.expires_at,
    'state', case when i.redeemed_at is not null then 'active'
      when i.expires_at <= now() then 'expired' else 'pending' end
  ) order by u.username), '[]'::jsonb)
  into accounts
  from edpvz_dispute_access.invitations i
  join public.edpvz_profiles u on u.user_id = i.recipient
  where i.organization_id = p_org;

  result := coalesce(accounts->0, jsonb_build_object('state', 'none'));
  if code is not null then
    select item into result from jsonb_array_elements(accounts) as item
    where item->>'username' = btrim(p_username);
    result := result || jsonb_build_object('code', code);
  end if;
  return result || jsonb_build_object('accounts', accounts);
end $$;

revoke all on function public.edpvz_dispute_manage_access(text,text,text) from public, anon;
grant execute on function public.edpvz_dispute_manage_access(text,text,text) to authenticated;
