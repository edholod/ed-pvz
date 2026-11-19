create table public.edpvz_ivideon_extra_connections (
  user_id uuid not null references auth.users(id) on delete cascade,
  id uuid not null,
  label text not null check (char_length(label) between 1 and 80),
  encrypted_key text not null,
  primary key (user_id, id)
);
alter table public.edpvz_ivideon_extra_connections enable row level security;
revoke all on public.edpvz_ivideon_extra_connections from anon, authenticated;
grant select, insert, update, delete on public.edpvz_ivideon_extra_connections to service_role;
