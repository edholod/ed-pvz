create or replace function public.edpvz_ivideon_allowed()
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
  select public.edpvz_surveillance_allowed() or exists (
    select 1
    from public.edpvz_profiles
    where user_id = (select auth.uid()) and role = 'owner'
  );
$$;

revoke all on function public.edpvz_ivideon_allowed() from public, anon;
grant execute on function public.edpvz_ivideon_allowed() to authenticated;
