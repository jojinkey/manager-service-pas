-- 1) Opening report now runs 11:30 am to 3:30 pm for every outlet, effective immediately.
--    New policy version from today; today's and later opening reports that are still open/pending move to the
--    new deadline at once. Anything already submitted, or already marked missed, is left exactly as it is.
do $$declare p public.policies;ns time:='11:30';ne time:='15:30';begin
 for p in select * from public.policies where current and type='opening' and (end_time is distinct from ne or start_time is distinct from ns) order by restaurant_id loop
  update public.policies set current=false where id=p.id;
  p.id:=gen_random_uuid();p.version:=p.version+1;p.current:=true;p.start_time:=ns;p.end_time:=ne;p.effective_from:=public.ist_today();p.created_at:=clock_timestamp();
  insert into public.policies select p.*;
  update public.occurrences o set policy_id=p.id,policy_snapshot=to_jsonb(p),
   deadline=(o.business_date+ne) at time zone p.timezone
   where o.restaurant_id=p.restaurant_id and o.type='opening' and o.submitted_at is null and o.missed_at is null
    and o.business_date>=public.ist_today() and (o.business_date+ne) at time zone p.timezone>clock_timestamp();
  insert into public.audit_log(action,restaurant_id,after_value) values('opening_deadline_update',p.restaurant_id,jsonb_build_object('start',ns,'end',ne));
 end loop;
end$$;

-- Make sure every still-pending opening report (today onward) follows the current policy's 3:30 pm deadline,
-- even if the policy itself was already created at 3:30 pm by migration 013.
update public.occurrences o set policy_id=p.id,policy_snapshot=to_jsonb(p),deadline=(o.business_date+p.end_time) at time zone p.timezone
 from public.policies p
 where p.restaurant_id=o.restaurant_id and p.type='opening' and p.current and p.end_time='15:30' and o.type='opening'
  and o.submitted_at is null and o.missed_at is null and o.business_date>=public.ist_today()
  and (o.business_date+p.end_time) at time zone p.timezone>clock_timestamp() and o.deadline is distinct from (o.business_date+p.end_time) at time zone p.timezone;

-- 2) One-day extension (admin only). Changes the deadline of ONE report occurrence; the standing policy is untouched.
--    Takes effect immediately, but only while the new time is still ahead of the clock and the report has not
--    already been submitted or marked missed.
create function public.extend_report_deadline(p_occurrence uuid,p_time time) returns timestamptz language plpgsql security definer set search_path=public as $$
declare o occurrences;tz text;day date;nd timestamptz;begin
 if not public.is_admin() then raise exception 'Administrator access required';end if;
 select * into o from occurrences where id=p_occurrence for update;
 if o.id is null then raise exception 'Report not found';end if;
 if o.submitted_at is not null then raise exception 'This report is already submitted';end if;
 if o.missed_at is not null then raise exception 'This report was already marked missed, so its time has passed';end if;
 tz:=coalesce(o.policy_snapshot->>'timezone','Asia/Kolkata');
 day:=(o.opens_at at time zone tz)::date;
 nd:=(day+p_time) at time zone tz;
 if nd<=o.opens_at then nd:=((day+1)+p_time) at time zone tz;end if;
 if nd<=clock_timestamp() then raise exception 'That time has already passed. Choose a time later than now';end if;
 update occurrences set deadline=nd,policy_snapshot=policy_snapshot||jsonb_build_object('extended_to',nd,'extended_by',auth.uid()) where id=o.id;
 insert into audit_log(actor,action,restaurant_id,before_value,after_value) values(auth.uid(),'extend_report_deadline',o.restaurant_id,jsonb_build_object('deadline',o.deadline,'occurrence',o.id,'type',o.type),jsonb_build_object('deadline',nd,'business_date',o.business_date));
 return nd;
end$$;
revoke all on function public.extend_report_deadline(uuid,time) from public,anon;
grant execute on function public.extend_report_deadline(uuid,time) to authenticated;
