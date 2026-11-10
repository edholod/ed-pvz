-- Tighten tenant isolation without changing existing accounts or business rows.
create or replace function public.edpvz_point_exists(pid text)
returns boolean language sql stable security definer set search_path='' as $$
 select auth.uid() is not null and exists(select 1 from public.edpvz_points where point_id=pid)
$$;
revoke all on function public.edpvz_point_exists(text) from public,anon;
grant execute on function public.edpvz_point_exists(text) to authenticated;

create or replace function public.edpvz_can_read_profile(target uuid)
returns boolean language sql stable security definer set search_path='' as $$
 select auth.uid() is not null and (
 target=auth.uid()
 or exists(select 1 from public.edpvz_memberships m join public.edpvz_points p using(point_id)
           where p.owner_id=auth.uid() and m.user_id=target)
 or exists(select 1 from public.edpvz_memberships m join public.edpvz_points p using(point_id)
           where m.user_id=auth.uid() and m.status='approved' and p.owner_id=target)
 or exists(select 1 from public.edpvz_memberships mine join public.edpvz_memberships peer using(point_id)
           where mine.user_id=auth.uid() and mine.status='approved' and peer.user_id=target and peer.status='approved'))
$$;
revoke all on function public.edpvz_can_read_profile(uuid) from public,anon;
grant execute on function public.edpvz_can_read_profile(uuid) to authenticated;

alter policy profiles_read on public.edpvz_profiles to authenticated using(public.edpvz_can_read_profile(user_id));
alter policy points_read on public.edpvz_points to authenticated using(public.edpvz_is_team(point_id));
alter policy members_insert on public.edpvz_memberships to authenticated with check (
 user_id=(select auth.uid()) and status='pending' and permissions='{}'::jsonb
 and exists(select 1 from public.edpvz_profiles p where p.user_id=(select auth.uid()) and p.role in ('employee','manager','supervisor'))
 and public.edpvz_point_exists(point_id));
alter policy requests_insert on public.edpvz_shift_requests to authenticated with check (
 owner_id=(select auth.uid()) and status='pending' and public.edpvz_is_owner(point_id)
 and exists(select 1 from public.edpvz_memberships m where m.point_id=edpvz_shift_requests.point_id and m.user_id=manager_id and m.status='approved')
 and exists(select 1 from public.edpvz_profiles p where p.user_id=manager_id and p.role in ('employee','manager')));
alter policy manager_shifts_update on public.edpvz_manager_shifts to authenticated
 using(manager_id=(select auth.uid())) with check (
 manager_id=(select auth.uid()) and exists(select 1 from public.edpvz_memberships m
 where m.point_id=edpvz_manager_shifts.point_id and m.user_id=(select auth.uid()) and m.status='approved'));
-- REST clients and workers never need DDL privileges on application tables.
revoke truncate,references,trigger on all tables in schema public from anon,authenticated,service_role;

revoke maintain on all tables in schema public from anon,authenticated,service_role;
