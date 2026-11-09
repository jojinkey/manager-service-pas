-- Admin manual point adjustments (add or deduct) with a mandatory reason. Ledger history is append-only.
alter table public.score_ledger alter column occurrence_id drop not null;
alter table public.score_ledger alter column policy_id drop not null;
alter table public.score_ledger add column note text;
alter table public.score_ledger add column adjusted_by uuid references public.profiles;
do $$declare c record;begin
 for c in select conname from pg_constraint where conrelid='public.score_ledger'::regclass and contype='c' and (pg_get_constraintdef(oid) like '%reason%') loop
  execute format('alter table public.score_ledger drop constraint %I',c.conname);
 end loop;
end$$;
alter table public.score_ledger add constraint score_ledger_reason_check check(reason in('submitted','missed','adjustment'));
alter table public.score_ledger add constraint score_ledger_amount_direction check(
 (reason='missed' and amount<=0) or (reason='submitted' and amount>=0)
 or (reason='adjustment' and amount<>0 and occurrence_id is null and adjusted_by is not null and length(trim(coalesce(note,'')))>=3));

create function public.adjust_points(p_user uuid,p_amount integer,p_note text) returns integer language plpgsql security definer set search_path=public as $$
declare target profiles;cid uuid;balance integer;delta integer;begin
 if not is_admin() then raise exception 'Administrator access required';end if;
 select * into target from profiles where id=p_user and active and role='manager' for update;
 if target.id is null then raise exception 'Choose an active manager. Only managers carry points.';end if;
 if p_amount is null or p_amount=0 or abs(p_amount)>200 then raise exception 'Enter a points change between 1 and 200 (use a minus sign to deduct)';end if;
 if length(trim(coalesce(p_note,'')))<3 or length(p_note)>500 then raise exception 'Give a short reason (3 to 500 characters)';end if;
 cid:=ensure_score_cycle(target.restaurant_id,clock_timestamp());
 if cid is null then raise exception 'Start this outlet''s points cycle first';end if;
 select 200+coalesce(sum(amount),0) into balance from score_ledger where cycle_id=cid and manager_id=p_user;
 delta:=case when p_amount>0 then least(p_amount,200-balance) else p_amount end;
 if delta=0 then raise exception 'Already at the 200-point maximum';end if;
 insert into score_ledger(restaurant_id,manager_id,cycle_id,business_date,reason,amount,note,adjusted_by)
 values(target.restaurant_id,p_user,cid,ist_today(),'adjustment',delta,trim(p_note),auth.uid());
 insert into audit_log(actor,action,restaurant_id,after_value) values(auth.uid(),'adjust_points',target.restaurant_id,jsonb_build_object('employee_id',p_user,'requested',p_amount,'applied',delta,'note',trim(p_note)));
 return delta;
end$$;
revoke all on function public.adjust_points(uuid,integer,text) from public,anon;
grant execute on function public.adjust_points(uuid,integer,text) to authenticated;
