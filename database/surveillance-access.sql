create or replace function public.edpvz_surveillance_allowed()
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
  select coalesce(auth.uid() = '0f75065b-2b26-4a87-bf26-005f5a2284d4'::uuid, false);
$$;

revoke all on function public.edpvz_surveillance_allowed() from public, anon;
grant execute on function public.edpvz_surveillance_allowed() to authenticated;
