do $$
declare
 definition text := pg_get_functiondef('public.edpvz_dispute_sync_commit(jsonb)'::regprocedure);
 previous text := 'amount=excluded.amount,raw=excluded.raw,';
 replacement text := $update$amount=excluded.amount,raw=
    case when not (excluded.raw ? 'movement') and (edpvz_dispute_observations.raw ? 'movement')
      then jsonb_set(excluded.raw,'{movement}',edpvz_dispute_observations.raw->'movement')
      else excluded.raw end,$update$;
begin
 if strpos(definition,previous)=0 then raise exception 'Unexpected WB observation update'; end if;
 execute replace(definition,previous,replacement);
end $$;
