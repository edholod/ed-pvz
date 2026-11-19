create table public.edpvz_ivideon_camera_shares (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  recipient_id uuid not null references auth.users(id) on delete cascade,
  camera_id text not null check (camera_id ~ '^[a-zA-Z0-9_-]{1,120}:[0-9]{1,8}$'),
  connection_id uuid,
  camera_name text not null check (char_length(camera_name) between 1 and 160),
  can_live boolean not null,
  can_archive boolean not null,
  can_download boolean not null,
  can_edit boolean not null,
  check (owner_id <> recipient_id),
  check (can_live or can_archive or can_download or can_edit),
  unique (owner_id, recipient_id, camera_id)
);
create index edpvz_ivideon_shares_recipient on public.edpvz_ivideon_camera_shares (recipient_id);
create table public.edpvz_ivideon_shared_exports (
  share_id uuid not null references public.edpvz_ivideon_camera_shares(id) on delete cascade,
  export_id text not null,
  created_at timestamptz not null default now(),
  primary key (share_id, export_id)
);
alter table public.edpvz_ivideon_camera_shares enable row level security;
alter table public.edpvz_ivideon_shared_exports enable row level security;
revoke all on public.edpvz_ivideon_camera_shares, public.edpvz_ivideon_shared_exports from public, anon, authenticated;
grant select, insert, update, delete on public.edpvz_ivideon_camera_shares, public.edpvz_ivideon_shared_exports to service_role;
