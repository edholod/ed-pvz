create or replace function public.edpvz_private_registered_users(
  search_term text default '',
  page_size integer default 50,
  page_offset integer default 0
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  result jsonb;
begin
  if auth.uid() is distinct from '0f75065b-2b26-4a87-bf26-005f5a2284d4'::uuid then
    raise exception 'Access denied' using errcode = '42501';
  end if;

  with matching_profiles as (
    select p.user_id, p.username, p.role, p.created_at
    from public.edpvz_profiles p
    where coalesce(search_term, '') = '' or strpos(lower(p.username), lower(search_term)) > 0
  ), page as (
    select p.user_id, p.username, p.role, p.created_at
    from matching_profiles p
    order by p.created_at desc, p.username
    limit least(greatest(coalesce(page_size, 50), 1), 100)
    offset greatest(coalesce(page_offset, 0), 0)
  ), point_lists as (
    select pt.owner_id,
      jsonb_agg(jsonb_build_object(
        'point_id', pt.point_id, 'name', pt.name, 'market', pt.market, 'created_at', pt.created_at
      ) order by pt.created_at desc, pt.point_id) as points
    from public.edpvz_points pt
    join page on page.user_id = pt.owner_id
    group by pt.owner_id
  )
  select jsonb_build_object(
    'total', (select count(*) from matching_profiles),
    'users', coalesce((
      select jsonb_agg(jsonb_build_object(
        'username', p.username, 'role', p.role, 'created_at', p.created_at,
        'points', coalesce(pt.points, '[]'::jsonb)
      ) order by p.created_at desc, p.username)
      from page p
      left join point_lists pt on pt.owner_id = p.user_id
    ), '[]'::jsonb)
  ) into result;
  return result;
end;
$function$;

revoke execute on function public.edpvz_private_registered_users(text, integer, integer) from public, anon;
grant execute on function public.edpvz_private_registered_users(text, integer, integer) to authenticated;
