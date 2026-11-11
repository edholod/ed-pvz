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

select pg_temp.require(
 public.edpvz_dispute_manage_password(current_setting('fixture.tag')||'a','save','Synthetic-test-password-2026')->>'password_set'='true',
 'admin sets custom password');
select pg_temp.denied($q$select public.edpvz_dispute_manage_password(current_setting('fixture.tag')||'b','save','Synthetic-test-password-2026')$q$,'password_in_use');

select set_config('request.jwt.claim.sub',current_setting('fixture.a'),true);
select pg_temp.denied($q$select public.edpvz_dispute_manage_password(current_setting('fixture.tag')||'a','save','Synthetic-test-password-2027')$q$,'42501');
select pg_temp.require(public.edpvz_dispute_owner_access('list')='[]'::jsonb,'no access before password');
select pg_temp.require(
 public.edpvz_dispute_redeem_password('Synthetic-test-password-2026')->>'organization_id'=current_setting('fixture.tag')||'a',
 'first account redeems password');
select pg_temp.require(jsonb_array_length(public.edpvz_dispute_owner_access('read',null,current_setting('fixture.tag')||'a')->'rows')=2,
 'first account reads both points');
select pg_temp.denied($q$select public.edpvz_dispute_owner_access('read',null,current_setting('fixture.tag')||'b')$q$,'42501');
select pg_temp.denied($q$select public.edpvz_dispute_owner_access('update',null,current_setting('fixture.tag')||'a')$q$,'42501');

select set_config('request.jwt.claim.sub',current_setting('fixture.b'),true);
select pg_temp.require(
 public.edpvz_dispute_redeem_password('Synthetic-test-password-2026')->>'organization_id'=current_setting('fixture.tag')||'a',
 'second account redeems the same password');
select pg_temp.require(jsonb_array_length(public.edpvz_dispute_owner_access('list'))=1,'second account is granted the legal entity');
do $$
begin
 for i in 1..5 loop
  perform pg_temp.require(public.edpvz_dispute_redeem_password('Incorrect-test-password')->>'error'='invalid_password','wrong password denied');
 end loop;
 perform pg_temp.require(public.edpvz_dispute_redeem_password('Synthetic-test-password-2026')->>'error'='rate_limited','guessing limited');
end $$;

select set_config('request.jwt.claim.sub',current_setting('fixture.admin'),true);
select pg_temp.require(
 public.edpvz_dispute_manage_access(current_setting('fixture.tag')||'a','revoke',
 'audit_'||substr(replace(current_setting('fixture.a'),'-',''),1,24))->>'password_set'='false',
 'revocation disables shared password');
select set_config('request.jwt.claim.sub',current_setting('fixture.a'),true);
select pg_temp.require(public.edpvz_dispute_redeem_password('Synthetic-test-password-2026')->>'error'='invalid_password','old password cannot restore revoked access');
select pg_temp.require(public.edpvz_dispute_owner_access('list')='[]'::jsonb,'revoked account no longer has access');
select set_config('request.jwt.claim.sub',current_setting('fixture.b'),true);
select pg_temp.require(jsonb_array_length(public.edpvz_dispute_owner_access('list'))=1,'other account retains access');
set local role anon;
select pg_temp.denied($q$select public.edpvz_dispute_redeem_password('Synthetic-test-password-2026')$q$,'42501');
reset role;
rollback;
select 'PASS: custom shared password works for two owner accounts, scoped read-only access, rate limit and safe revocation; fixtures rolled back' as result;
