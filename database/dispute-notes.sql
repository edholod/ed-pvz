create table if not exists public.edpvz_dispute_notes (
 observation_id uuid primary key references public.edpvz_dispute_observations(id) on delete restrict,
 owner_id uuid not null default auth.uid(),
 status text not null default 'Обращение не создано' check(status in ('Обращение не создано','Тикет в работе','Оспаривание отклонено по тех. причинам','Вина сотрудника','Успешно оспорено')),
 sticker text not null default '' check(length(sticker)<=200),
 cost numeric(14,2) check(cost>=0), withholding_date date, withholding_type text not null default '' check(length(withholding_type)<=200),
 employee_fault text not null default '' check(length(employee_fault)<=200),employee_fault_date date,ticket_number text not null default '' check(length(ticket_number)<=200),comment text not null default '' check(length(comment)<=20000),
 revision bigint not null default 0,updated_at timestamptz not null default now()
);
alter table public.edpvz_dispute_notes enable row level security;
revoke all on public.edpvz_dispute_notes from anon,authenticated;
grant select,insert,update on public.edpvz_dispute_notes to authenticated;
grant all on public.edpvz_dispute_notes to service_role;
create policy dispute_notes_select on public.edpvz_dispute_notes for select to authenticated using(owner_id=(select auth.uid()) and owner_id='0f75065b-2b26-4a87-bf26-005f5a2284d4');
create policy dispute_notes_insert on public.edpvz_dispute_notes for insert to authenticated with check(owner_id=(select auth.uid()) and owner_id='0f75065b-2b26-4a87-bf26-005f5a2284d4' and exists(select 1 from public.edpvz_dispute_observations o where o.id=observation_id and o.owner_id=(select auth.uid())));
create policy dispute_notes_update on public.edpvz_dispute_notes for update to authenticated using(owner_id=(select auth.uid()) and owner_id='0f75065b-2b26-4a87-bf26-005f5a2284d4') with check(owner_id=(select auth.uid()) and owner_id='0f75065b-2b26-4a87-bf26-005f5a2284d4' and exists(select 1 from public.edpvz_dispute_observations o where o.id=observation_id and o.owner_id=(select auth.uid())));
create or replace function public.edpvz_dispute_notes_revision() returns trigger language plpgsql set search_path=public,pg_temp as $$begin new.revision=old.revision+1;new.updated_at=now();return new;end$$;
revoke all on function public.edpvz_dispute_notes_revision() from public,anon,authenticated;
create trigger dispute_notes_revision before update on public.edpvz_dispute_notes for each row execute function public.edpvz_dispute_notes_revision();
