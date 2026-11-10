-- Integration checks run in one rolled-back transaction: no test accounts persist.
begin;
select set_config('audit.owner',gen_random_uuid()::text,true),set_config('audit.other',gen_random_uuid()::text,true),set_config('audit.staff',gen_random_uuid()::text,true),set_config('audit.stranger',gen_random_uuid()::text,true),set_config('audit.supervisor',gen_random_uuid()::text,true);
select set_config('audit.point','audit-'||gen_random_uuid()::text,true),set_config('audit.foreign_point','audit-'||gen_random_uuid()::text,true);
create function pg_temp.assert_true(ok boolean,label text) returns void language plpgsql as $$begin if ok is distinct from true then raise exception 'ASSERT: %',label;end if;end$$;
create function pg_temp.expect_denied(q text,codes text[] default array['42501']) returns void language plpgsql as $$begin begin execute q;exception when others then if sqlstate=any(codes) then return;else raise;end if;end;raise exception 'UNEXPECTED SUCCESS: %',q;end$$;
insert into auth.users(id,email,raw_app_meta_data)
select current_setting('audit.'||kind)::uuid,'audit_'||replace(current_setting('audit.'||kind),'-','')||'@example.invalid',jsonb_build_object('edpvz_role',role)
from (values('owner','owner'),('other','owner'),('staff','employee'),('stranger','employee'),('supervisor','supervisor')) v(kind,role);
insert into public.edpvz_profiles(user_id,username,role)
select current_setting('audit.'||kind)::uuid,'audit_'||substr(replace(current_setting('audit.'||kind),'-',''),1,24),role
from (values('owner','owner'),('other','owner'),('staff','employee'),('stranger','employee'),('supervisor','supervisor')) v(kind,role);
insert into public.edpvz_points(point_id,owner_id,name) values(current_setting('audit.point'),current_setting('audit.owner')::uuid,'Synthetic A'),(current_setting('audit.foreign_point'),current_setting('audit.other')::uuid,'Synthetic B');
insert into public.edpvz_memberships(point_id,user_id,status) values(current_setting('audit.point'),current_setting('audit.staff')::uuid,'approved'),(current_setting('audit.point'),current_setting('audit.supervisor')::uuid,'pending');
insert into public.edpvz_user_data(user_id,namespace,payload) values(current_setting('audit.owner')::uuid,'audit','{"private":true}');
insert into public.edpvz_tasks(point_id,owner_id,assignee_id,title,status) values(current_setting('audit.point'),current_setting('audit.owner')::uuid,current_setting('audit.staff')::uuid,'Synthetic task','in_progress');
set local role authenticated;
select set_config('request.jwt.claim.sub',current_setting('audit.owner'),true);
select pg_temp.assert_true((select count(*)=1 from public.edpvz_points where point_id in(current_setting('audit.point'),current_setting('audit.foreign_point'))),'owner cannot see foreign point');
insert into public.edpvz_shift_requests(point_id,owner_id,manager_id,shift_date) values(current_setting('audit.point'),auth.uid(),current_setting('audit.staff')::uuid,current_date);
select pg_temp.assert_true((select count(*)=1 from public.edpvz_shift_requests where point_id=current_setting('audit.point')),'employee accepts manager-compatible shift offers');
select set_config('request.jwt.claim.sub',current_setting('audit.staff'),true);
select pg_temp.assert_true((select count(*)=0 from public.edpvz_profiles where user_id=current_setting('audit.other')::uuid),'foreign profiles hidden');
select pg_temp.assert_true((select count(*)=0 from public.edpvz_points where point_id=current_setting('audit.foreign_point')),'foreign points hidden');
select pg_temp.assert_true((select count(*)=0 from public.edpvz_user_data where user_id=current_setting('audit.owner')::uuid),'foreign backups hidden');
select pg_temp.assert_true((select count(*)=0 from public.edpvz_dispute_observations),'private disputes hidden');
select pg_temp.assert_true((select count(*)=0 from public.edpvz_finance_entries),'owner finance hidden');
insert into public.edpvz_manager_shifts(manager_id,point_id,shift_date) values(auth.uid(),current_setting('audit.point'),current_date);
select pg_temp.expect_denied($q$update public.edpvz_manager_shifts set point_id=current_setting('audit.foreign_point') where manager_id=auth.uid()$q$);
update public.edpvz_shift_requests set status='accepted' where manager_id=auth.uid() and point_id=current_setting('audit.point');
select pg_temp.assert_true((select status='accepted' from public.edpvz_shift_requests where manager_id=auth.uid() and point_id=current_setting('audit.point')),'employee can accept own request');
select pg_temp.expect_denied($q$update public.edpvz_tasks set status='done' where assignee_id=auth.uid()$q$,array['P0001']);
select pg_temp.expect_denied($q$update public.edpvz_tasks set owner_id=auth.uid() where assignee_id=auth.uid()$q$,array['P0001']);
update public.edpvz_tasks set status='pending_approval' where assignee_id=auth.uid();
select set_config('request.jwt.claim.sub',current_setting('audit.stranger'),true);
select pg_temp.expect_denied($q$insert into public.edpvz_memberships(point_id,user_id,status,permissions) values(current_setting('audit.point'),auth.uid(),'pending','{"finance":true}')$q$);
insert into public.edpvz_memberships(point_id,user_id,status) values(current_setting('audit.point'),auth.uid(),'pending');
select pg_temp.assert_true((select count(*)=1 from public.edpvz_memberships where user_id=auth.uid()),'join request with known point ID still works');
select pg_temp.expect_denied($q$select public.edpvz_private_registration_stats()$q$);
select set_config('request.jwt.claim.sub',current_setting('audit.supervisor'),true);
select pg_temp.assert_true((select count(*)=0 from public.edpvz_user_data where user_id=current_setting('audit.owner')::uuid),'supervisor cannot read owner backups');
select set_config('request.jwt.claim.sub',current_setting('audit.owner'),true);
update public.edpvz_tasks set status='done' where point_id=current_setting('audit.point');
select pg_temp.assert_true((select status='done' from public.edpvz_tasks where point_id=current_setting('audit.point')),'owner can approve completed task');
select pg_temp.assert_true((select count(*)=1 from public.edpvz_profiles where user_id=current_setting('audit.stranger')::uuid),'owner sees pending applicant profile');
set local role anon;
select pg_temp.expect_denied($q$select * from public.edpvz_profiles$q$);
select pg_temp.expect_denied($q$select * from public.edpvz_dispute_observations$q$);
reset role;
rollback;
select 'PASS: role isolation, employee offers, task approval, joins and private-data denial; fixtures rolled back' as result;
