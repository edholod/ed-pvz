create table public.edpvz_ivideon_connections (
  user_id uuid primary key references auth.users(id) on delete cascade,
  encrypted_key text not null,
  updated_at timestamptz not null default now()
);
alter table public.edpvz_ivideon_connections enable row level security;
revoke all on table public.edpvz_ivideon_connections from public, anon, authenticated;
grant select, insert, update, delete on table public.edpvz_ivideon_connections to service_role;
