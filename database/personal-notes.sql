create table public.edpvz_personal_notes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  title text not null default '' check (char_length(title) <= 120),
  body text not null default '' check (char_length(body) <= 20000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint personal_note_has_content check (btrim(title) <> '' or btrim(body) <> '')
);

create index edpvz_personal_notes_user_updated_idx
  on public.edpvz_personal_notes (user_id, updated_at desc, id);

alter table public.edpvz_personal_notes enable row level security;
revoke all on public.edpvz_personal_notes from public, anon, authenticated;
grant select, insert (title, body), update (title, body), delete
  on public.edpvz_personal_notes to authenticated;

create policy personal_notes_owner on public.edpvz_personal_notes
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create function public.edpvz_touch_personal_note() returns trigger
language plpgsql security invoker set search_path = '' as $$
begin
  new.updated_at := greatest(clock_timestamp(), old.updated_at + interval '1 microsecond');
  return new;
end;
$$;

revoke all on function public.edpvz_touch_personal_note() from public, anon, authenticated;
create trigger edpvz_personal_note_updated before update on public.edpvz_personal_notes
  for each row execute function public.edpvz_touch_personal_note();
