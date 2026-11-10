-- Account calendars use the existing self-only RLS table; no elevated privileges.
alter table public.edpvz_points add column if not exists market text not null default 'wb' check (market in ('wb','ozon','ym'));
create or replace function public.edpvz_calendar_write(p_revision bigint,p_data jsonb)
returns jsonb language plpgsql security invoker set search_path=public,pg_temp as $$
declare uid uuid:=auth.uid(); current_payload jsonb; current_revision bigint; result jsonb;
begin
 if uid is null then raise exception 'AUTH_REQUIRED'; end if;
 if p_revision<0 or p_revision is null or p_data is null or jsonb_typeof(p_data)<>'object' or octet_length(p_data::text)>7000000 then raise exception 'INVALID_CALENDAR'; end if;
 if not (p_data ?& array['points','people','shifts','incidents','payments','notes','settings','history']) then raise exception 'INVALID_CALENDAR'; end if;
 perform pg_advisory_xact_lock(hashtextextended('edpvz_calendar:'||uid::text,0));
 select payload into current_payload from public.edpvz_user_data where user_id=uid and namespace='pvz_calendar_live' for update;
 current_revision:=coalesce((current_payload->>'revision')::bigint,0);
 if current_revision<>p_revision then return jsonb_build_object('conflict',true,'revision',current_revision,'data',current_payload->'data'); end if;
 if current_payload is not null then
  insert into public.edpvz_user_data(user_id,namespace,payload,updated_at) values(uid,'pvz_calendar_previous',current_payload,now())
  on conflict(user_id,namespace) do update set payload=excluded.payload,updated_at=excluded.updated_at;
 end if;
 result:=jsonb_build_object('revision',current_revision+1,'data',p_data);
 insert into public.edpvz_user_data(user_id,namespace,payload,updated_at) values(uid,'pvz_calendar_live',result,now())
 on conflict(user_id,namespace) do update set payload=excluded.payload,updated_at=excluded.updated_at;
 return result;
end $$;
revoke all on function public.edpvz_calendar_write(bigint,jsonb) from public,anon;
grant execute on function public.edpvz_calendar_write(bigint,jsonb) to authenticated;
