-- All fixtures, including the invitation, are rolled back.
begin;
select set_config('fixture.admin','0f75065b-2b26-4a87-bf26-005f5a2284d4',true);
select set_config('fixture.a',gen_random_uuid()::text,true),set_config('fixture.b',gen_random_uuid()::text,true);
select set_config('fixture.tag','invite-test-'||gen_random_uuid()::text,true);
create function pg_temp.require(ok boolean, label text) returns void language plpgsql as $$
begin if ok is distinct from true then raise exception 'ASSERT: %',label; end if; end $$;
create function pg_temp.denied(q text, reason text) returns void language plpgsql as $$
begin
  begin execute q; exception when others then
    if sqlerrm = reason or (reason = '42501' and sqlstate = reason) then return; end if;
    raise;
  end;
  raise exception 'UNEXPECTED ACCESS';
end $$;

insert into auth.users(id,email)
select current_setting('fixture.'||k)::uuid,current_setting('fixture.'||k)||'@example.invalid'
from (values ('a'),('b')) as v(k);
insert into public.edpvz_profiles(user_id,username,role)
select current_setting('fixture.'||k)::uuid,
  'audit_'||substr(replace(current_setting('fixture.'||k),'-',''),1,24),'owner'
from (values ('a'),('b')) as v(k);
insert into public.edpvz_dispute_organizations(research_id,owner_id,name_exact)
select current_setting('fixture.tag')||k,current_setting('fixture.admin')::uuid,current_setting('fixture.tag')||k
from (values ('a'),('b')) as v(k);
insert into public.edpvz_dispute_points(wb_point_id,owner_id,organization_research_id,address_observed)
select current_setting('fixture.tag')||point,current_setting('fixture.admin')::uuid,current_setting('fixture.tag')||org,'Тестовый ПВЗ'
from (values ('1','a'),('2','a'),('3','b')) as v(point,org);
insert into public.edpvz_dispute_observations
  (owner_id,organization_research_id,wb_point_id,category,source_namespace,source_event_id,title,wb_state,raw)
select current_setting('fixture.admin')::uuid,current_setting('fixture.tag')||org,current_setting('fixture.tag')||point,
  'Зависший',current_setting('fixture.tag'),'observed:v2:'||point,'Тест '||point,'to-hold',
  '{"collection_since":"2026-10-01","internal":"must not appear"}'
from (values ('1','a'),('2','a'),('3','b')) as v(point,org);

set local role authenticated;
select set_config('request.jwt.claim.sub',current_setting('fixture.admin'),true);
do $$
declare
  org text := current_setting('fixture.tag')||'a';
  login text := 'audit_'||substr(replace(current_setting('fixture.a'),'-',''),1,24);
  old_code text;
  new_code text;
  second_code text;
begin
  old_code := public.edpvz_dispute_manage_access(org,'issue',login)->>'code';
  new_code := public.edpvz_dispute_manage_access(org,'issue',login)->>'code';
  perform pg_temp.require(new_code ~ '^PVZ-[A-F0-9]{32}$' and old_code <> new_code,'new code rotates pending code');
  perform set_config('fixture.code',new_code,true);
  perform set_config('fixture.old_code',old_code,true);
  second_code := public.edpvz_dispute_manage_access(
    org,'issue','audit_'||substr(replace(current_setting('fixture.b'),'-',''),1,24)
  )->>'code';
  perform set_config('fixture.second_code',second_code,true);
  perform pg_temp.require(second_code <> new_code,'each account gets its own code');
  perform pg_temp.require(jsonb_array_length(public.edpvz_dispute_manage_access(org,'status')->'accounts')=2,
    'both invites exist for the same legal entity');
  perform pg_temp.require(not (public.edpvz_dispute_manage_access(org,'status') ? 'code'),'status does not return plaintext');
end $$;
select set_config('request.jwt.claim.sub',current_setting('fixture.b'),true);
select pg_temp.denied($q$select public.edpvz_dispute_owner_access('redeem',current_setting('fixture.code'))$q$,'invalid_code');
select pg_temp.denied($q$select public.edpvz_dispute_manage_access(current_setting('fixture.tag')||'a','status')$q$,'42501');

select set_config('request.jwt.claim.sub',current_setting('fixture.a'),true);
select pg_temp.require(public.edpvz_dispute_owner_access('list')='[]'::jsonb,'no section before redemption');
select pg_temp.denied($q$select public.edpvz_dispute_owner_access('redeem',current_setting('fixture.old_code'))$q$,'invalid_code');
select pg_temp.require(
  public.edpvz_dispute_owner_access('redeem',current_setting('fixture.code'))->>'organization_id'=current_setting('fixture.tag')||'a',
  'intended owner redeems');
select pg_temp.denied($q$select public.edpvz_dispute_owner_access('redeem',current_setting('fixture.code'))$q$,'invalid_code');
select pg_temp.require(jsonb_array_length(public.edpvz_dispute_owner_access('list'))=1,'only authorized organization is listed');
select pg_temp.require((
  select jsonb_array_length(data->'points')=2 and jsonb_array_length(data->'rows')=2
    and data::text not like '%must not appear%' and data::text not like '%Тест 3%'
  from (select public.edpvz_dispute_owner_access('read',null,current_setting('fixture.tag')||'a') as data) q
),'only scoped rows and fields are exposed');
select pg_temp.denied($q$select public.edpvz_dispute_owner_access('read',null,current_setting('fixture.tag')||'b')$q$,'42501');
select pg_temp.require((select count(*)=0 from public.edpvz_dispute_observations),'direct access stays private');
select pg_temp.denied($q$select * from edpvz_dispute_access.invitations$q$,'42501');

set local role anon;
select pg_temp.denied($q$select public.edpvz_dispute_owner_access('list')$q$,'42501');
set local role authenticated;
select set_config('request.jwt.claim.sub',current_setting('fixture.admin'),true);
select set_config('request.jwt.claim.sub',current_setting('fixture.b'),true);
select pg_temp.require(
  public.edpvz_dispute_owner_access('redeem',current_setting('fixture.second_code'))->>'organization_id'=current_setting('fixture.tag')||'a',
  'second account redeems for the same legal entity');
select pg_temp.require(jsonb_array_length(public.edpvz_dispute_owner_access('read',null,current_setting('fixture.tag')||'a')->'rows')=2,
  'second account sees the same scoped points');
select pg_temp.denied($q$select public.edpvz_dispute_owner_access('read',null,current_setting('fixture.tag')||'b')$q$,'42501');
select set_config('request.jwt.claim.sub',current_setting('fixture.admin'),true);
select pg_temp.denied($q$select public.edpvz_dispute_manage_access(current_setting('fixture.tag')||'a','revoke')$q$,'account_required');
select pg_temp.require(
  jsonb_array_length(public.edpvz_dispute_manage_access(current_setting('fixture.tag')||'a','revoke',
    'audit_'||substr(replace(current_setting('fixture.a'),'-',''),1,24))->'accounts')=1,
  'only the selected account is revoked'
);
select set_config('request.jwt.claim.sub',current_setting('fixture.a'),true);
select pg_temp.require(public.edpvz_dispute_owner_access('list')='[]'::jsonb,'revoked access is removed');
select pg_temp.denied($q$select public.edpvz_dispute_owner_access('read',null,current_setting('fixture.tag')||'a')$q$,'42501');
select set_config('request.jwt.claim.sub',current_setting('fixture.b'),true);
select pg_temp.require(jsonb_array_length(public.edpvz_dispute_owner_access('list'))=1,'other account retains its access');
reset role;
rollback;
select 'PASS: two separate owner accounts access the same legal entity; foreign scope denied; independent revoke; fixtures rolled back' as result;
