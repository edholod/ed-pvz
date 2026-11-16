-- The caller's existing ticket and message RLS still applies to direct reads.
create or replace view public.edpvz_dispute_ticket_reply_state
with (security_invoker = true) as
select t.id, t.owner_id, t.organization_research_id, t.wb_point_id,
  t.namespace, t.ticket_number, t.status, t.title, t.created_local,
  case
    when last_message.role = 'wb_support' then 'needs_reply'
    when last_message.role = 'user' and last_message.had_wb_reply then 'answered'
    when last_message.role = 'user' then 'waiting_wb'
    else 'unknown'
  end as reply_state,
  case when last_message.role = 'wb_support' then last_message.message_at + interval '72 hours' end as reply_due_at
from public.edpvz_dispute_tickets t
left join lateral (
  select m.message_at,
    case when m.author_role = 'unknown' and m.raw->>'author_label' ~ '^[0-9]{5,15}$'
      and m.raw->>'author_label' <> split_part(m.message_text, chr(10), 1)
      then 'user' else m.author_role end as role,
    exists (
      select 1 from public.edpvz_dispute_ticket_messages wb
      where wb.ticket_id = t.id and wb.owner_id = t.owner_id and wb.is_current and wb.author_role = 'wb_support'
    ) as had_wb_reply
  from public.edpvz_dispute_ticket_messages m
  where m.ticket_id = t.id and m.owner_id = t.owner_id and m.is_current
    and m.author_role <> 'system'
  order by m.sequence_number desc nulls last, m.message_at desc nulls last, m.id desc
  limit 1
) last_message on true;

revoke all on public.edpvz_dispute_ticket_reply_state from public, anon;
grant select on public.edpvz_dispute_ticket_reply_state to authenticated;

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

  if p_action is null or p_action not in ('read', 'tickets', 'ticket_history') or not exists (
    select 1 from edpvz_dispute_access.invitations i
    join public.edpvz_dispute_organizations o on o.research_id = i.organization_id
    where i.organization_id = p_org and i.recipient = uid
      and i.redeemed_at is not null and o.owner_id = admin
  ) then
    raise exception 'access_denied' using errcode = '42501';
  end if;

  -- For ticket_history, p_after carries the UUID of the clicked ticket.
  if p_action = 'ticket_history' then
    select jsonb_build_object(
      'ticket_number', t.ticket_number, 'title', t.title, 'history_complete', t.history_complete,
      'messages', coalesce((
        select jsonb_agg(jsonb_build_object(
          'author_role', m.author_role, 'message_text', m.message_text,
          'message_at', m.message_at, 'raw', m.raw
        ) order by m.sequence_number nulls last, m.message_at, m.id)
        from public.edpvz_dispute_ticket_messages m
        where m.owner_id = t.owner_id and m.ticket_id = t.id and m.is_current
      ), '[]'::jsonb)
    ) into result
    from public.edpvz_dispute_tickets t
    join public.edpvz_dispute_points p on p.owner_id = t.owner_id
      and p.organization_research_id = t.organization_research_id and p.wb_point_id = t.wb_point_id
    where t.owner_id = admin and t.organization_research_id = p_org and t.id = p_after
      and t.created_local ~ '^[0-9]{2}[.][0-9]{2}[.][0-9]{4}'
          and (substring(t.created_local from 7 for 4) || substring(t.created_local from 4 for 2) || substring(t.created_local from 1 for 2)) >= '20261001';
    if not found then
      raise exception 'access_denied' using errcode = '42501';
    end if;
    return result;
  end if;

  if p_action = 'tickets' then
    return jsonb_build_object(
      'tickets', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', t.id, 'organization_research_id', t.organization_research_id, 'wb_point_id', t.wb_point_id,
          'namespace', t.namespace, 'ticket_number', t.ticket_number,
          'status', t.status, 'title', t.title, 'created_local', t.created_local,
          'reply_state', t.reply_state, 'reply_due_at', t.reply_due_at,
          'linked_withholding', exists (
            select 1 from public.edpvz_dispute_observations d
            where d.owner_id = t.owner_id and d.organization_research_id = t.organization_research_id
              and d.wb_point_id = t.wb_point_id and d.raw->>'ticket_number' = t.ticket_number
              and d.is_current and d.wb_state = 'to-hold'
          )
        ) order by t.id)
        from public.edpvz_dispute_ticket_reply_state t
        join public.edpvz_dispute_points p on p.owner_id = t.owner_id
          and p.organization_research_id = t.organization_research_id and p.wb_point_id = t.wb_point_id
        where t.owner_id = admin and t.organization_research_id = p_org
          and t.status in ('Новый', 'В работе', 'Ожидает решения')
          and t.created_local ~ '^[0-9]{2}[.][0-9]{2}[.][0-9]{4}'
          and (substring(t.created_local from 7 for 4) || substring(t.created_local from 4 for 2) || substring(t.created_local from 1 for 2)) >= '20261001'
      ), '[]'::jsonb),
      'scopes', coalesce((
        select jsonb_agg(jsonb_build_object('scope', s.scope, 'state', s.state, 'last_success', s.last_success) order by s.scope)
        from public.edpvz_dispute_points p
        cross join (values ('legacy'), ('new')) as source(namespace)
        join public.edpvz_dispute_sync_scopes s
          on s.scope = 'wb:' || p_org || ':' || p.wb_point_id || ':tickets:' || source.namespace
          and s.owner_id = p.owner_id
        where p.owner_id = admin and p.organization_research_id = p_org
      ), '[]'::jsonb)
    );
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
          nullif(btrim(n.employee_fault), '') as employee_fault,
          nullif(btrim(n.comment), '') as comment,
          case when o.photo_url ~ '^https://[^/?]+[.](wbbasket|wb|wildberries)[.]ru/[^?]+[.](webp|jpg|jpeg|png)$'
            then o.photo_url end as photo_url,
          left(o.raw->>'ticket_number', 40) as wb_ticket_number,
          wb.status as wb_ticket_status,
          coalesce(nullif(n.ticket_number, ''), left(o.raw->>'ticket_number', 40)) as ticket
        from public.edpvz_dispute_observations o
        join public.edpvz_dispute_points p on p.wb_point_id = o.wb_point_id
          and p.organization_research_id = o.organization_research_id and p.owner_id = o.owner_id
        left join lateral (
          select entry.* from public.edpvz_dispute_notes entry
          join public.edpvz_dispute_observations source on source.id = entry.observation_id
            and source.owner_id = entry.owner_id
          where entry.owner_id = o.owner_id and source.organization_research_id = o.organization_research_id
            and source.wb_point_id = o.wb_point_id and source.category = o.category
            and (source.id = o.id or (
              source.barcode is not distinct from o.barcode
              and coalesce(source.raw->>'group','') = coalesce(o.raw->>'group','')
              and coalesce(source.raw->>'occurrence','1') = coalesce(o.raw->>'occurrence','1')
            ))
          order by (source.id = o.id) desc, entry.updated_at desc
          limit 1
        ) n on true
        left join lateral (
          select case when count(*) = 1 then min(t.status) end as status
          from public.edpvz_dispute_tickets t
          where t.owner_id = o.owner_id and t.organization_research_id = o.organization_research_id
            and t.wb_point_id = o.wb_point_id and t.ticket_number = o.raw->>'ticket_number'
        ) wb on true
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

revoke all on function public.edpvz_dispute_owner_access(text,text,text,uuid) from public, anon;
grant execute on function public.edpvz_dispute_owner_access(text,text,text,uuid) to authenticated;
