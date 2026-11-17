create table public.edpvz_ivideon_camera_settings (
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  camera_id text not null check (camera_id ~ '^[a-zA-Z0-9_-]{1,120}:[0-9]{1,8}$'),
  display_name text not null default '' check (char_length(display_name) <= 100),
  point_id text references public.edpvz_points(point_id) on delete set null,
  primary key (user_id, camera_id)
);
alter table public.edpvz_ivideon_camera_settings enable row level security;
revoke all on public.edpvz_ivideon_camera_settings from public, anon, authenticated;
grant select, insert, update on public.edpvz_ivideon_camera_settings to authenticated;

create policy ivideon_camera_read on public.edpvz_ivideon_camera_settings
for select to authenticated using (user_id = (select auth.uid()) and (select public.edpvz_ivideon_allowed()));

create policy ivideon_camera_insert on public.edpvz_ivideon_camera_settings
for insert to authenticated with check (
  user_id = (select auth.uid()) and (select public.edpvz_ivideon_allowed())
  and (point_id is null or exists (
    select 1 from public.edpvz_points p
    where p.point_id = edpvz_ivideon_camera_settings.point_id and p.owner_id = (select auth.uid())
  ))
);

create policy ivideon_camera_update on public.edpvz_ivideon_camera_settings
for update to authenticated
using (user_id = (select auth.uid()) and (select public.edpvz_ivideon_allowed()))
with check (
  user_id = (select auth.uid()) and (select public.edpvz_ivideon_allowed())
  and (point_id is null or exists (
    select 1 from public.edpvz_points p
    where p.point_id = edpvz_ivideon_camera_settings.point_id and p.owner_id = (select auth.uid())
  ))
);

create function public.edpvz_ivideon_save_camera(p_camera_id text, p_display_name text, p_point_id text)
returns void
language sql
security invoker
set search_path = ''
as $$
  insert into public.edpvz_ivideon_camera_settings (camera_id, display_name, point_id)
  values (p_camera_id, pg_catalog.btrim(coalesce(p_display_name, '')), p_point_id)
  on conflict (user_id, camera_id) do update
  set display_name = excluded.display_name, point_id = excluded.point_id;
$$;
revoke all on function public.edpvz_ivideon_save_camera(text,text,text) from public, anon;
grant execute on function public.edpvz_ivideon_save_camera(text,text,text) to authenticated;
