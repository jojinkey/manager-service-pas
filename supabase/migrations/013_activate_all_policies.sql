-- Activate all four report policies (opening, closing, incident, briefing) for EVERY outlet, effective today,
-- each with the outlet's assigned manager and all eight rules confirmed. Safe to re-run: policies that are already
-- correct are left alone. Outlets with no active manager stay switched off and are listed in a notice.
do $$declare r record;t public.report_kind;p public.policies;mgr uuid;ns time;ne time;today date:=public.ist_today();
 ok jsonb:='{"calendar":true,"points":true,"reset":true,"responsibility":true,"incident":true,"handover":true,"director":true,"retention":true}';
 appr jsonb;fresh boolean;begin
 for r in select id from public.restaurants order by id loop
  select m.id into mgr from public.profiles m where m.restaurant_id=r.id and m.role='manager' and m.active and m.removed_at is null
   order by (m.id=(select manager_id from public.policies where restaurant_id=r.id and current and manager_id is not null order by type limit 1)) desc,m.name limit 1;
  if mgr is null then raise notice 'Outlet % has no active manager: policies left switched off',r.id;continue;end if;
  foreach t in array array['opening','closing','incident','briefing']::public.report_kind[] loop
   if t='opening' then ns:='11:30';ne:='14:30';else ns:='22:30';ne:='11:30';end if;
   appr:=ok||jsonb_build_object('incident_rule','daily_declaration','handover_rule','previous_service_day');
   select * into p from public.policies where restaurant_id=r.id and type=t and current;
   if p.id is not null and p.enabled and p.manager_id=mgr and p.start_time=ns and p.end_time=ne and p.reward=5 and p.missed_penalty=20 and p.approvals@>appr then continue;end if;
   if p.id is not null then update public.policies set current=false where id=p.id;end if;
   insert into public.policies(restaurant_id,type,version,current,enabled,start_time,end_time,timezone,manager_id,reward,missed_penalty,effective_from,daily_required_from,operating_days,closed_dates,approvals)
   values(r.id,t,coalesce(p.version,0)+1,true,true,ns,ne,'Asia/Kolkata',mgr,5,20,today,today,array[0,1,2,3,4,5,6],array[]::date[],appr);
   insert into public.audit_log(action,restaurant_id,after_value) values('policy_activated_all',r.id,jsonb_build_object('type',t,'manager_id',mgr,'effective_from',today));
  end loop;
 end loop;
end$$;

-- Create today's and tomorrow's report windows from the new policies right away.
select public.reconcile_reports();
