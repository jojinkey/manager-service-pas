-- 1) Restart every outlet's points cycle today: all managers back to 200, 15-day cycle. History is kept.
do $$declare s record;cid uuid;stamp timestamptz:=clock_timestamp();begin
 for s in select * from public.score_settings order by restaurant_id loop
  if s.current_cycle_id is not null then
   update public.score_cycles set ends_at=greatest(starts_at+interval '1 microsecond',least(ends_at,stamp)) where id=s.current_cycle_id;
  end if;
  insert into public.score_cycles(restaurant_id,starts_at,ends_at,manual) values(s.restaurant_id,stamp,stamp+interval '15 days',true) returning id into cid;
  update public.score_settings set current_cycle_id=cid,reset_every_days=15,minimum_benchmark=coalesce(minimum_benchmark,140),updated_at=stamp where restaurant_id=s.restaurant_id;
  insert into public.audit_log(action,restaurant_id,after_value) values('manual_points_reset',s.restaurant_id,jsonb_build_object('cycle_id',cid,'starting_score',200,'reason','v3 launch restart'));
  perform public.refresh_benchmark_alerts(s.restaurant_id);
 end loop;
end$$;

-- 2) Default windows (IST). Opening 11:30 am-2:30 pm. Closing, Incident and Briefing 10:30 pm-11:30 am next morning,
--    counted against the previous evening's date. Applied as a new policy version from today; windows that
--    are already open or past are left exactly as filed, only not-yet-open reports pick up the new times.
do $$declare p public.policies;ns time;ne time;n integer:=0;begin
 for p in select * from public.policies where current and start_time is not null and end_time is not null order by restaurant_id,type loop
  if p.type='opening' then ns:='11:30';ne:='14:30';else ns:='22:30';ne:='11:30';end if;
  continue when p.start_time=ns and p.end_time=ne;
  update public.policies set current=false where id=p.id;
  p.id:=gen_random_uuid();p.version:=p.version+1;p.current:=true;p.start_time:=ns;p.end_time:=ne;p.effective_from:=public.ist_today();p.created_at:=clock_timestamp();
  p.enabled:=p.enabled and exists(select 1 from public.profiles m where m.id=p.manager_id and m.active and m.role='manager' and m.restaurant_id=p.restaurant_id);
  insert into public.policies select p.*;
  update public.occurrences o set policy_id=p.id,policy_snapshot=to_jsonb(p),
   opens_at=(o.business_date+ns) at time zone p.timezone,
   deadline=((o.business_date+case when ne<=ns then 1 else 0 end)+ne) at time zone p.timezone
   where o.restaurant_id=p.restaurant_id and o.type=p.type and o.submitted_at is null and o.missed_at is null and o.opens_at>clock_timestamp();
  insert into public.audit_log(action,restaurant_id,after_value) values('default_window_update',p.restaurant_id,jsonb_build_object('type',p.type,'start',ns,'end',ne));
  n:=n+1;
 end loop;
end$$;

-- 3) Remove an employee entirely.
alter table public.profiles add column removed_at timestamptz;
-- Returns 'deleted' when nothing references the person, otherwise 'archived': the login, phone and PIN are
-- erased and the person leaves the register, but the name stays on the reports they filed (history is never lost).
create function public.remove_employee(p_actor uuid,p_user uuid) returns text language plpgsql security definer set search_path=public as $$
declare target profiles;begin
 if not exists(select 1 from profiles where id=p_actor and role='admin' and active) then raise exception 'Administrator access required';end if;
 if p_actor=p_user then raise exception 'You cannot remove your own account';end if;
 perform pg_advisory_xact_lock(hashtextextended('account-status',0));
 select * into target from profiles where id=p_user and removed_at is null for update;
 if target.id is null then raise exception 'Account unavailable';end if;
 if target.role='admin' and (select count(*) from profiles where role='admin' and active and removed_at is null)<=1 then raise exception 'At least one active administrator is required';end if;
 update profiles set active=false where id=p_user;
 delete from private_pin_credentials where user_id=p_user;
 insert into audit_log(actor,action,restaurant_id,after_value) values(p_actor,'remove_employee',target.restaurant_id,jsonb_build_object('employee_id',p_user,'name',target.name,'role',target.role));
 begin
  delete from assignment_history where user_id=p_user;
  delete from profiles where id=p_user;
  return 'deleted';
 exception when foreign_key_violation then
  update profiles set removed_at=clock_timestamp(),phone=null,email=null,pin_ready=false where id=p_user;
  return 'archived';
 end;
end$$;
revoke all on function public.remove_employee(uuid,uuid) from public,anon,authenticated;
grant execute on function public.remove_employee(uuid,uuid) to service_role;
