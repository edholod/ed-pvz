-- Additive synchronization support; preserves all manual cards and existing imports.
grant select on public.edpvz_dispute_organizations, public.edpvz_dispute_points, public.edpvz_dispute_ingest_credentials to service_role;
grant select, insert, update on public.edpvz_dispute_observations, public.edpvz_dispute_tickets, public.edpvz_dispute_ticket_messages, public.edpvz_dispute_sync_runs, public.edpvz_dispute_sync_scopes, public.edpvz_wb_encrypted_sessions to service_role;
grant usage, select on sequence public.edpvz_dispute_sync_runs_id_seq to service_role;
alter table public.edpvz_dispute_observations add column if not exists identity_kind text not null default 'native';
alter table public.edpvz_dispute_observations add column if not exists wb_state text;
alter table public.edpvz_dispute_observations add column if not exists last_seen_at timestamptz;
alter table public.edpvz_dispute_observations add column if not exists is_current boolean not null default true;
alter table public.edpvz_dispute_observations add column if not exists last_seen_run bigint;
alter table public.edpvz_dispute_tickets add column if not exists title text;
alter table public.edpvz_dispute_tickets add column if not exists created_local text;
alter table public.edpvz_dispute_tickets add column if not exists baseline_completed_at timestamptz;
alter table public.edpvz_dispute_tickets add column if not exists message_order text[] not null default '{}';
alter table public.edpvz_dispute_tickets add column if not exists history_complete boolean not null default false;
alter table public.edpvz_dispute_tickets add column if not exists detail_error text;
alter table public.edpvz_dispute_tickets add column if not exists last_attempt_at timestamptz;
alter table public.edpvz_dispute_ticket_messages add column if not exists sequence_number integer;
alter table public.edpvz_dispute_ticket_messages add column if not exists is_current boolean not null default true;
alter table public.edpvz_dispute_ticket_messages add column if not exists raw jsonb not null default '{}';
alter table public.edpvz_dispute_sync_runs add column if not exists report jsonb not null default '{}';
create index if not exists edpvz_dispute_obs_scope_idx on public.edpvz_dispute_observations(source_namespace,is_current);
create index if not exists edpvz_dispute_messages_order_idx on public.edpvz_dispute_ticket_messages(ticket_id,is_current,sequence_number);
create table if not exists public.edpvz_dispute_sync_control(
 owner_id uuid primary key default '0f75065b-2b26-4a87-bf26-005f5a2284d4',
 requested_at timestamptz, handled_request_at timestamptz, next_due_at timestamptz,
 lease_owner text, lease_until timestamptz, active_run bigint,
 last_state text, last_report jsonb not null default '{}', updated_at timestamptz not null default now(),
 check(owner_id='0f75065b-2b26-4a87-bf26-005f5a2284d4'::uuid)
);
alter table public.edpvz_dispute_sync_control enable row level security;
revoke all on public.edpvz_dispute_sync_control from public,anon,authenticated;
grant select on public.edpvz_dispute_sync_control to authenticated;
grant all on public.edpvz_dispute_sync_control to service_role;
create policy sync_control_owner_read on public.edpvz_dispute_sync_control for select to authenticated
 using((select auth.uid())='0f75065b-2b26-4a87-bf26-005f5a2284d4'::uuid);

create or replace function public.edpvz_dispute_sync_commit(p jsonb) returns jsonb
language plpgsql security invoker set search_path=public,pg_temp as $function$
declare
 own constant uuid := '0f75065b-2b26-4a87-bf26-005f5a2284d4';
 c public.edpvz_dispute_sync_control%rowtype;
 run bigint; item jsonb; msg jsonb; t public.edpvz_dispute_tickets%rowtype;
 ids text[]; previous text[]; appended boolean; attention boolean; complete boolean;
 ns text; sc text; n integer:=0; n_new integer:=0; n_updated integer:=0; existed boolean; i integer; last_reply timestamptz;
begin
 insert into public.edpvz_dispute_sync_control(owner_id) values(own) on conflict do nothing;
 select * into c from public.edpvz_dispute_sync_control where owner_id=own for update;
 if p->>'kind'='request' then
  update public.edpvz_dispute_sync_control set requested_at=now(),updated_at=now() where owner_id=own;
  return jsonb_build_object('ok',true,'requested',true);
 end if;
 if p->>'kind'='claim' then
  if c.lease_until>now() then return jsonb_build_object('claimed',false,'state','running'); end if;
  if not coalesce((p->>'force')::boolean,false) and c.next_due_at>now()
   and not exists(select 1 from public.edpvz_dispute_sync_runs where id=c.active_run and owner_id=own and status='running')
   and coalesce(c.requested_at,'epoch')<=coalesce(c.handled_request_at,'epoch') then
   return jsonb_build_object('claimed',false,'state',coalesce(c.last_state,'waiting'),'next_due_at',c.next_due_at);
  end if;
  if c.last_state in ('blocked','authentication_required') and not coalesce((p->>'force')::boolean,false)
   and coalesce(c.requested_at,'epoch')<=coalesce(c.handled_request_at,'epoch') then
   return jsonb_build_object('claimed',false,'state',c.last_state);
  end if;
  if c.active_run is not null then
   update public.edpvz_dispute_sync_runs set status='interrupted',finished_at=now(),error='lease_expired'
    where id=c.active_run and status='running';
  end if;
  insert into public.edpvz_dispute_sync_runs(owner_id,status) values(own,'running') returning id into run;
  update public.edpvz_dispute_sync_control set lease_owner=p->>'worker',lease_until=now()+interval '3 minutes',
   active_run=run,next_due_at=null,handled_request_at=requested_at,last_state='running',last_report=jsonb_build_object('state','running','rows',0,'tickets',0,'sections','[]'::jsonb,'started_at',now()),updated_at=now() where owner_id=own;
  return jsonb_build_object('claimed',true,'run_id',run);
 end if;
 if c.lease_owner is distinct from p->>'worker' or c.active_run is distinct from (p->>'run_id')::bigint or c.lease_until<now() then
  raise exception 'lease_not_owned';
 end if;
 run=c.active_run;
 if p->>'kind'='heartbeat' then
  update public.edpvz_dispute_sync_control set lease_until=now()+interval '3 minutes',last_report=coalesce(p->'report',last_report),updated_at=now() where owner_id=own;
  update public.edpvz_dispute_sync_runs set report=coalesce(p->'report',report) where id=run;
  return jsonb_build_object('ok',true,'run_id',run);
 end if;
 if p->>'kind'='finish' then
  update public.edpvz_dispute_sync_runs set status=p->>'state',finished_at=now(),report=coalesce(p->'report','{}'),
   checked_points=coalesce((p->'report'->>'checked_points')::integer,0),
   error=nullif(p->>'error','') where id=run;
  update public.edpvz_dispute_sync_control set lease_owner=null,lease_until=null,
   last_state=p->>'state',last_report=coalesce(p->'report','{}'),updated_at=now(),
   next_due_at=case when p->>'state' in ('ok','partial') then date_bin(interval '3 hours',now()-interval '17 minutes',timestamptz '2000-01-01 00:00:00+00')+interval '3 hours 17 minutes' else now()+interval '15 minutes' end
   where owner_id=own;
  return jsonb_build_object('ok',true,'run_id',run);
 end if;
 if p->>'kind'<>'scope' then raise exception 'invalid_kind'; end if;
 sc=p->>'scope';
 if length(sc)>200 or sc not like 'wb:%' then raise exception 'invalid_scope'; end if;
 if not exists(select 1 from public.edpvz_dispute_organizations where research_id=p->>'organization' and owner_id=own) then raise exception 'unknown_organization'; end if;
 if p->>'point' is not null and not exists(select 1 from public.edpvz_dispute_points where wb_point_id=p->>'point' and organization_research_id=p->>'organization' and owner_id=own) then raise exception 'point_organization_mismatch'; end if;
 complete=coalesce((p->>'complete')::boolean,false);
 for item in select value from jsonb_array_elements(coalesce(p->'rows','[]')) loop
  if item->>'organization_research_id'<>p->>'organization' or item->>'wb_point_id'<>p->>'point' then raise exception 'row_scope_mismatch'; end if;
  ns=item->>'source_namespace';
  if ns<>concat('browser:v1:',p->>'organization',':',p->>'point',':',p->>'category',':',p->>'state') then raise exception 'namespace_mismatch'; end if;
  if nullif(item->>'source_event_id','') is null then raise exception 'missing_observation_identity'; end if;
  select exists(select 1 from public.edpvz_dispute_observations where owner_id=own and source_namespace=ns and source_event_id=item->>'source_event_id') into existed;
  insert into public.edpvz_dispute_observations(owner_id,organization_research_id,wb_point_id,category,source_namespace,source_event_id,barcode,title,photo_url,amount,raw,provenance,identity_kind,wb_state,last_seen_at,last_seen_run,is_current)
   values(own,p->>'organization',p->>'point',item->>'category',ns,item->>'source_event_id',item->>'barcode',item->>'title',item->>'photo_url',nullif(item->>'amount','')::numeric,coalesce(item->'raw','{}'),'wb_browser_read_only',item->>'identity_kind',p->>'state',now(),run,true)
   on conflict(owner_id,source_namespace,source_event_id) do update set title=excluded.title,photo_url=excluded.photo_url,amount=excluded.amount,raw=excluded.raw,
    last_seen_at=now(),last_seen_run=run,is_current=true,wb_state=excluded.wb_state,identity_kind=excluded.identity_kind;
  n=n+1;
  if existed then n_updated=n_updated+1; else n_new=n_new+1; end if;
 end loop;
 if complete and p->>'category' is not null then
  ns=concat('browser:v1:',p->>'organization',':',p->>'point',':',p->>'category',':',p->>'state');
  if (p->>'expected_count') is not null and (select count(*) from public.edpvz_dispute_observations where owner_id=own and source_namespace=ns and last_seen_run=run)<>(p->>'expected_count')::integer then
   complete=false;
  else
   update public.edpvz_dispute_observations set is_current=false where owner_id=own and source_namespace=ns and last_seen_run is distinct from run;
  end if;
 end if;
 for item in select value from jsonb_array_elements(coalesce(p->'tickets','[]')) loop
  if item->>'organization_research_id'<>p->>'organization' or item->>'wb_point_id'<>p->>'point' then raise exception 'ticket_scope_mismatch'; end if;
  insert into public.edpvz_dispute_tickets(owner_id,organization_research_id,wb_point_id,namespace,ticket_number,status,title,created_local)
   values(own,p->>'organization',p->>'point',item->>'namespace',item->>'ticket_number',item->>'status',item->>'title',item->>'created_local')
   on conflict(owner_id,organization_research_id,namespace,ticket_number) do update set status=excluded.status,title=excluded.title,created_local=excluded.created_local
   returning * into t;
  update public.edpvz_dispute_tickets set last_attempt_at=now() where id=t.id;
  if jsonb_typeof(item->'messages')='array' and coalesce((item->>'history_complete')::boolean,false) then
   previous=t.message_order;
   select coalesce(array_agg(value->>'source_message_id' order by ordinal),'{}') into ids from jsonb_array_elements(item->'messages') with ordinality as e(value,ordinal);
   appended=t.baseline_completed_at is not null and cardinality(previous)>0 and cardinality(ids)>=cardinality(previous)
    and ids[1:cardinality(previous)]=previous;
   attention=false;last_reply=t.last_reply_at;
   update public.edpvz_dispute_ticket_messages set is_current=false where ticket_id=t.id;
   i=0;
   for msg in select value from jsonb_array_elements(item->'messages') loop
    insert into public.edpvz_dispute_ticket_messages(ticket_id,owner_id,source_message_id,author_role,message_text,message_at,sequence_number,is_current,raw)
     values(t.id,own,msg->>'source_message_id',msg->>'author_role',msg->>'message_text',nullif(msg->>'message_at','')::timestamptz,i,true,coalesce(msg->'raw','{}'))
     on conflict(ticket_id,source_message_id) do update set observed_at=now(),is_current=true,sequence_number=excluded.sequence_number,raw=excluded.raw;
    if msg->>'author_role'='wb_support' then
     if appended and i>=cardinality(previous) then attention=true; end if;
     if nullif(msg->>'message_at','') is not null then last_reply=greatest(last_reply,(msg->>'message_at')::timestamptz); end if;
    end if;
    i=i+1;
   end loop;
   update public.edpvz_dispute_tickets set message_order=ids,baseline_completed_at=coalesce(baseline_completed_at,now()),history_complete=true,
    last_checked_at=now(),last_reply_at=last_reply,needs_attention=needs_attention or attention,detail_error=null where id=t.id;
  elsif item->>'detail_error' is not null then
   update public.edpvz_dispute_tickets set detail_error=item->>'detail_error' where id=t.id;
  end if;
 end loop;
 insert into public.edpvz_dispute_sync_scopes(owner_id,scope,state,last_attempt,last_success,last_error,updated_at)
  values(own,sc,case when complete then 'ok' else coalesce(p->>'status','partial') end,now(),case when complete then now() else null end,
   case when complete then null else coalesce(p->>'status','partial') end,now())
  on conflict(scope) do update set state=excluded.state,last_attempt=now(),last_success=coalesce(excluded.last_success,edpvz_dispute_sync_scopes.last_success),last_error=excluded.last_error,updated_at=now();
 update public.edpvz_dispute_sync_control set lease_until=now()+interval '3 minutes',updated_at=now() where owner_id=own;
 update public.edpvz_dispute_sync_runs set new_cases=coalesce(new_cases,0)+n_new,updated_cases=coalesce(updated_cases,0)+n_updated where id=run;
 return jsonb_build_object('ok',true,'rows',n,'complete',complete);
end
$function$;
revoke all on function public.edpvz_dispute_sync_commit(jsonb) from public,anon,authenticated;
grant execute on function public.edpvz_dispute_sync_commit(jsonb) to service_role;

