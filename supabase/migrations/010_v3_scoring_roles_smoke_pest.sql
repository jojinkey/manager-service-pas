-- v3 spec: 200-point scoring (+5/-20, cap 200), chef/staff roles, outlet reassignment,
-- admin credential reset, weekly Smoke Test and weekly Pest Control.
-- History is never rewritten: reports, ledger, smoke tests, gaps and flags are retained.

-- ===== Roles =====
do $$declare c record;begin
 for c in select conname from pg_constraint where conrelid='public.profiles'::regclass and contype='c' loop
  execute format('alter table public.profiles drop constraint %I',c.conname);
 end loop;
end$$;
alter table public.profiles add constraint profiles_role_check check(role in('admin','manager','chef','staff'));
alter table public.profiles add constraint profiles_scope_check check((role='admin' and restaurant_id is null) or(role<>'admin' and restaurant_id is not null));
alter table public.profiles add constraint profiles_phone_format check(phone is null or phone ~ '^\+[1-9][0-9]{7,14}$');

-- Configurable screen permissions (no rebuild needed). Daily reports stay manager-only
-- until the owner decides whose points a chef/staff submission would count toward.
create table public.role_permissions(role text not null check(role in('manager','chef','staff')),capability text not null check(capability in('smoke_test','pest_control')),allowed boolean not null default false,primary key(role,capability));
insert into public.role_permissions values('manager','smoke_test',true),('manager','pest_control',true),('chef','smoke_test',true),('chef','pest_control',true),('staff','smoke_test',false),('staff','pest_control',false);
create function public.has_capability(cap text) returns boolean language sql stable security definer set search_path=public as $$
 select exists(select 1 from profiles p join role_permissions r on r.role=p.role and r.capability=cap and r.allowed where p.id=auth.uid() and p.active and p.restaurant_id is not null)$$;
create function public.set_role_permission(p_role text,p_capability text,p_allowed boolean) returns void language plpgsql security definer set search_path=public as $$begin
 if not is_admin() then raise exception 'Administrator access required';end if;
 update role_permissions set allowed=coalesce(p_allowed,false) where role=p_role and capability=p_capability;
 if not found then raise exception 'Unknown role or capability';end if;
 insert into audit_log(actor,action,after_value) values(auth.uid(),'set_role_permission',jsonb_build_object('role',p_role,'capability',p_capability,'allowed',p_allowed));
end$$;

-- ===== Scoring: start 200, cap 200, +5 on time, -20 missed, once per report per date =====
create or replace function public.record_score(o public.occurrences,why text) returns void language plpgsql security definer set search_path=public as $$
declare cid uuid;balance integer;delta integer;begin
 if why not in('submitted','missed') then raise exception 'Invalid score reason';end if;
 cid:=ensure_score_cycle(o.restaurant_id,clock_timestamp());
 if exists(select 1 from score_ledger where occurrence_id=o.id) then return;end if;
 if cid is null then delta:=0;
 else
  select 200+coalesce(sum(amount),0) into balance from score_ledger where cycle_id=cid and manager_id=o.manager_id;
  delta:=case when why='submitted' then least(5,greatest(0,200-balance)) else -20 end;
 end if;
 insert into score_ledger(occurrence_id,restaurant_id,manager_id,cycle_id,policy_id,business_date,reason,amount)
 values(o.id,o.restaurant_id,o.manager_id,cid,o.policy_id,o.business_date,why,delta) on conflict(occurrence_id) do nothing;
end$$;
create or replace view public.current_score_totals with(security_invoker=true) as
 select p.id as manager_id,p.restaurant_id,s.minimum_benchmark,s.current_cycle_id,
 (200+coalesce(sum(l.amount) filter(where c.ends_at>clock_timestamp()),0))::integer as points
 from public.profiles p left join public.score_settings s on s.restaurant_id=p.restaurant_id
 left join public.score_cycles c on c.id=s.current_cycle_id
 left join public.score_ledger l on l.cycle_id=c.id and l.manager_id=p.id
 where p.role='manager' and p.active group by p.id,p.restaurant_id,s.minimum_benchmark,s.current_cycle_id;
grant select on public.current_score_totals to authenticated;
-- Defaults: 15-day cycle, benchmark 140, cycle running for every outlet.
insert into public.score_settings(restaurant_id,reset_every_days,minimum_benchmark) select id,15,140 from public.restaurants on conflict(restaurant_id) do nothing;
update public.score_settings set minimum_benchmark=140 where minimum_benchmark is null;
do $$declare s record;cid uuid;begin
 for s in select * from public.score_settings where current_cycle_id is null loop
  insert into public.score_cycles(restaurant_id,starts_at,ends_at) values(s.restaurant_id,clock_timestamp(),clock_timestamp()+s.reset_every_days*interval '1 day') returning id into cid;
  update public.score_settings set current_cycle_id=cid where restaurant_id=s.restaurant_id;
 end loop;
end$$;

-- ===== Outlet reassignment (history stays with the outlet it was filed under) =====
create table public.assignment_history(id bigint generated always as identity primary key,user_id uuid not null references public.profiles,restaurant_id text not null references public.restaurants,assigned_at timestamptz not null default clock_timestamp(),unassigned_at timestamptz);
insert into public.assignment_history(user_id,restaurant_id) select id,restaurant_id from public.profiles where restaurant_id is not null;
alter table public.assignment_history enable row level security;
create policy admin_assignments on public.assignment_history for select to authenticated using(public.is_admin());
grant select on public.assignment_history to authenticated;
create or replace function public.reassign_outlet(p_user uuid,p_restaurant text) returns void language plpgsql security definer set search_path=public as $$
declare target profiles;begin
 if not is_admin() then raise exception 'Administrator access required';end if;
 if not exists(select 1 from restaurants where id=p_restaurant) then raise exception 'Unknown restaurant';end if;
 perform pg_advisory_xact_lock(hashtextextended('account-status',0));
 select * into target from profiles where id=p_user for update;
 if target.id is null or not target.active then raise exception 'Active account required';end if;
 if target.role='admin' then raise exception 'Administrators are not assigned to an outlet';end if;
 if target.restaurant_id=p_restaurant then raise exception 'Already assigned to this outlet';end if;
 -- Stop the old outlet's open schedules for this person; no miss is charged for the move.
 update policies set enabled=false where manager_id=p_user and enabled;
 update occurrences set enabled=false where manager_id=p_user and restaurant_id=target.restaurant_id and submitted_at is null and missed_at is null and deadline>clock_timestamp();
 update score_alerts set active=false where manager_id=p_user;
 update assignment_history set unassigned_at=clock_timestamp() where user_id=p_user and unassigned_at is null;
 insert into assignment_history(user_id,restaurant_id) values(p_user,p_restaurant);
 update profiles set restaurant_id=p_restaurant where id=p_user;
 insert into audit_log(actor,action,restaurant_id,before_value,after_value) values(auth.uid(),'reassign_outlet',p_restaurant,jsonb_build_object('employee_id',p_user,'restaurant_id',target.restaurant_id),jsonb_build_object('employee_id',p_user,'restaurant_id',p_restaurant,'history_preserved',true));
end$$;

-- ===== Admin credential reset (admin never sees a PIN; the person sets a new one) =====
create function public.reset_phone_credentials(p_actor uuid,p_user uuid,p_hash text) returns void language plpgsql security definer set search_path=public as $$
declare target profiles;begin
 if not exists(select 1 from profiles where id=p_actor and role='admin' and active) then raise exception 'Administrator access required';end if;
 select * into target from profiles where id=p_user and active for update;
 if target.id is null or target.role='admin' then raise exception 'Active employee account required';end if;
 if p_hash !~ '^[0-9a-f]{64}$' then raise exception 'Invalid setup details';end if;
 update private_pin_credentials set pin_hash=null,pin_salt=null,activation_hash=p_hash,activation_expires_at=clock_timestamp()+interval '24 hours',updated_at=clock_timestamp() where user_id=p_user;
 if not found then raise exception 'This person has no phone sign-in yet; issue a setup code instead';end if;
 update profiles set pin_ready=false where id=p_user;
 if to_regclass('auth.sessions') is not null then execute 'delete from auth.sessions where user_id=$1' using p_user;end if;
 insert into audit_log(actor,action,restaurant_id,after_value) values(p_actor,'reset_credentials',target.restaurant_id,jsonb_build_object('employee_id',p_user,'must_set_new_pin',true));
end$$;
drop function public.provision_phone_employee(uuid,uuid,text,text,text,text,text);
create function public.provision_phone_employee(p_actor uuid,p_user uuid,p_name text,p_email text,p_restaurant text,p_phone text,p_hash text,p_role text default 'manager') returns void language plpgsql security definer set search_path=public as $$begin
 if not exists(select 1 from profiles where id=p_actor and role='admin' and active) then raise exception 'Administrator access required';end if;
 if length(trim(p_name))<2 or length(trim(p_name))>120 then raise exception 'Enter the employee name';end if;
 if p_role not in('manager','chef','staff') then raise exception 'Choose manager, chef or staff';end if;
 insert into profiles(id,name,email,role,restaurant_id) values(p_user,trim(p_name),p_email,p_role,p_restaurant);
 insert into assignment_history(user_id,restaurant_id) values(p_user,p_restaurant);
 perform issue_phone_setup(p_actor,p_user,p_phone,p_hash);
 insert into audit_log(actor,action,restaurant_id,after_value) values(p_actor,'create_phone_employee',p_restaurant,jsonb_build_object('employee_id',p_user,'role',p_role));
end$$;

-- ===== Helpers =====
create function public.ist_today() returns date language sql stable as $$select (clock_timestamp() at time zone 'Asia/Kolkata')::date$$;

-- ===== Immutable record guard =====
create function public.forbid_change() returns trigger language plpgsql as $$begin raise exception 'This record is immutable';end$$;

-- ===== Smoke Test (weekly, per outlet) =====
create table public.smoke_config(id integer primary key default 1 check(id=1),fields jsonb not null,updated_at timestamptz not null default now());
insert into public.smoke_config(fields) values('[{"id":"result","label":"Smoke test result","type":"pass_fail","required":true},{"id":"notes","label":"Notes","type":"text","required":false}]');
create function public.set_smoke_config(p_fields jsonb) returns void language plpgsql security definer set search_path=public as $$
declare f jsonb;ids text[]:='{}';begin
 if not is_admin() then raise exception 'Administrator access required';end if;
 if jsonb_typeof(p_fields)<>'array' or jsonb_array_length(p_fields)=0 or jsonb_array_length(p_fields)>60 then raise exception 'Provide between 1 and 60 checklist fields';end if;
 for f in select * from jsonb_array_elements(p_fields) loop
  if coalesce(f->>'id','') !~ '^[a-z0-9_]{1,40}$' or length(trim(coalesce(f->>'label','')))=0 or length(f->>'label')>200 or coalesce(f->>'type','') not in('pass_fail','yes_no','text','number') then raise exception 'Each field needs an id, a label and a type (pass_fail, yes_no, text, number)';end if;
  if f->>'id'=any(ids) then raise exception 'Duplicate field id';end if;
  ids:=ids||(f->>'id');
 end loop;
 update smoke_config set fields=p_fields,updated_at=clock_timestamp() where id=1;
 insert into audit_log(actor,action,after_value) values(auth.uid(),'set_smoke_config',jsonb_build_object('fields',p_fields));
end$$;
create table public.smoke_baselines(restaurant_id text primary key references public.restaurants,start_date date not null,set_by uuid not null references public.profiles,set_at timestamptz not null default clock_timestamp());
create function public.set_smoke_baseline(p_restaurant text,p_date date) returns void language plpgsql security definer set search_path=public as $$begin
 if not is_admin() then raise exception 'Administrator access required';end if;
 if not exists(select 1 from restaurants where id=p_restaurant) then raise exception 'Unknown restaurant';end if;
 if p_date is null or p_date>ist_today() then raise exception 'The baseline date cannot be in the future';end if;
 insert into smoke_baselines(restaurant_id,start_date,set_by) values(p_restaurant,p_date,auth.uid()) on conflict(restaurant_id) do update set start_date=excluded.start_date,set_by=excluded.set_by,set_at=clock_timestamp();
 insert into audit_log(actor,action,restaurant_id,after_value) values(auth.uid(),'set_smoke_baseline',p_restaurant,jsonb_build_object('start_date',p_date));
 perform check_smoke_overdue(p_restaurant);
end$$;
create table public.smoke_tests(
 id uuid primary key default gen_random_uuid(),restaurant_id text not null references public.restaurants,test_date date not null,
 submitted_at timestamptz not null default clock_timestamp(),submitted_by uuid not null references public.profiles,submitted_by_name text not null,
 late boolean not null,data jsonb not null,fields_snapshot jsonb not null,unique(restaurant_id,test_date)
);
create trigger smoke_tests_immutable before update or delete on public.smoke_tests for each row execute function public.forbid_change();
-- One row per gap larger than 7 days. The open row (resolved_at is null) is the single live alert for the outlet.
create table public.smoke_gaps(
 id uuid primary key default gen_random_uuid(),restaurant_id text not null references public.restaurants,from_date date not null,to_date date,
 days integer,opened_at timestamptz not null default clock_timestamp(),resolved_at timestamptz,unique(restaurant_id,from_date)
);
create unique index smoke_one_open_alert on public.smoke_gaps(restaurant_id) where resolved_at is null;
create function public.guard_smoke_gaps() returns trigger language plpgsql as $$begin
 if tg_op='DELETE' then raise exception 'Gap history is permanent';end if;
 if old.resolved_at is not null then raise exception 'A closed gap cannot change';end if;
 if new.restaurant_id<>old.restaurant_id or new.from_date<>old.from_date or new.opened_at<>old.opened_at then raise exception 'Gap start cannot change';end if;
 return new;
end$$;
create trigger smoke_gaps_guard before update or delete on public.smoke_gaps for each row execute function public.guard_smoke_gaps();

create function public.check_smoke_overdue(p_restaurant text default null) returns void language plpgsql security definer set search_path=public as $$
declare r record;ref date;begin
 for r in select id from restaurants where p_restaurant is null or id=p_restaurant loop
  select max(d) into ref from (select max(test_date) d from smoke_tests where restaurant_id=r.id union all select start_date from smoke_baselines where restaurant_id=r.id) x;
  if ref is null then continue;end if;
  if ist_today()-ref>7 and not exists(select 1 from smoke_gaps where restaurant_id=r.id and resolved_at is null) and not exists(select 1 from smoke_gaps where restaurant_id=r.id and from_date=ref) then
   insert into smoke_gaps(restaurant_id,from_date) values(r.id,ref);
   insert into audit_log(action,restaurant_id,after_value) values('smoke_test_overdue',r.id,jsonb_build_object('last_reference_date',ref));
  end if;
 end loop;
end$$;

create function public.submit_smoke_test(p_restaurant text,p_test_date date,p_data jsonb) returns public.smoke_tests language plpgsql security definer set search_path=public as $$
declare actor profiles;cfg jsonb;f jsonb;v jsonb;prev date;nxt date;rec smoke_tests;stamp timestamptz:=clock_timestamp();today date:=ist_today();begin
 select * into actor from profiles where id=auth.uid() and active;
 if actor.id is null or actor.role='admin' or actor.restaurant_id is distinct from p_restaurant or not has_capability('smoke_test') then raise exception 'You cannot file a smoke test for this outlet';end if;
 if p_test_date is null then raise exception 'Enter the date the smoke test was done';end if;
 if p_test_date>today then raise exception 'The smoke test date cannot be in the future';end if;
 if jsonb_typeof(p_data)<>'object' or octet_length(p_data::text)>65536 then raise exception 'Invalid smoke test entry';end if;
 select fields into cfg from smoke_config where id=1;
 for f in select * from jsonb_array_elements(cfg) loop
  v:=p_data->(f->>'id');
  if coalesce((f->>'required')::boolean,false) and (v is null or v='null'::jsonb or btrim(v #>> '{}')='') then raise exception 'Complete "%"',f->>'label';end if;
  if v is not null and v<>'null'::jsonb and btrim(v #>> '{}')<>'' then
   if f->>'type'='pass_fail' and (v #>> '{}') not in('pass','fail') then raise exception 'Choose pass or fail for "%"',f->>'label';end if;
   if f->>'type'='yes_no' and (v #>> '{}') not in('yes','no') then raise exception 'Choose yes or no for "%"',f->>'label';end if;
   if f->>'type'='number' and (v #>> '{}') !~ '^-?[0-9]+(\.[0-9]+)?$' then raise exception 'Enter a number for "%"',f->>'label';end if;
  end if;
 end loop;
 if exists(select 1 from smoke_tests where restaurant_id=p_restaurant and test_date=p_test_date) then raise exception 'A smoke test is already recorded for this date';end if;
 -- Gap evidence: a gap bigger than 7 days before this test is kept permanently, never overwritten.
 select max(d) into prev from (select max(test_date) d from smoke_tests where restaurant_id=p_restaurant and test_date<p_test_date union all select start_date from smoke_baselines where restaurant_id=p_restaurant and start_date<p_test_date) x;
 insert into smoke_tests(restaurant_id,test_date,submitted_at,submitted_by,submitted_by_name,late,data,fields_snapshot) values(p_restaurant,p_test_date,stamp,actor.id,actor.name,p_test_date<today,p_data,cfg) returning * into rec;
 if prev is not null and p_test_date-prev>7 then
  update smoke_gaps set to_date=p_test_date,days=p_test_date-prev,resolved_at=stamp where restaurant_id=p_restaurant and from_date=prev and resolved_at is null;
  if not found then
   insert into smoke_gaps(restaurant_id,from_date,to_date,days,opened_at,resolved_at) values(p_restaurant,prev,p_test_date,p_test_date-prev,stamp,stamp) on conflict(restaurant_id,from_date) do nothing;
  end if;
 end if;
 -- A backdated entry can also split an older span: keep a gap between it and the next recorded test.
 select min(test_date) into nxt from smoke_tests where restaurant_id=p_restaurant and test_date>p_test_date;
 if nxt is not null and nxt-p_test_date>7 then
  insert into smoke_gaps(restaurant_id,from_date,to_date,days,opened_at,resolved_at) values(p_restaurant,p_test_date,nxt,nxt-p_test_date,stamp,stamp) on conflict(restaurant_id,from_date) do nothing;
 end if;
 -- Close the live alert once the newest reference is within 7 days.
 update smoke_gaps g set to_date=(select max(test_date) from smoke_tests where restaurant_id=p_restaurant),days=(select max(test_date) from smoke_tests where restaurant_id=p_restaurant)-g.from_date,resolved_at=stamp
  where g.restaurant_id=p_restaurant and g.resolved_at is null and today-(select max(test_date) from smoke_tests where restaurant_id=p_restaurant)<=7 and (select max(test_date) from smoke_tests where restaurant_id=p_restaurant)>g.from_date;
 insert into audit_log(actor,action,restaurant_id,after_value) values(actor.id,'submit_smoke_test',p_restaurant,jsonb_build_object('test_date',p_test_date,'submitted_at',stamp,'late',p_test_date<today));
 perform check_smoke_overdue(p_restaurant);
 return rec;
end$$;

create view public.smoke_status with(security_invoker=true) as
 select r.id as restaurant_id,t.last_test_date,b.start_date as baseline_date,x.ref as reference_date,
  case when x.ref is null then null else ist_today()-x.ref end as days_since,
  case when x.ref is null then 'none' when ist_today()-x.ref>7 then 'overdue' else 'ok' end as status,
  (select g.id from smoke_gaps g where g.restaurant_id=r.id and g.resolved_at is null) as open_gap_id
 from restaurants r
 left join lateral (select max(test_date) last_test_date from smoke_tests where restaurant_id=r.id) t on true
 left join smoke_baselines b on b.restaurant_id=r.id
 left join lateral (select greatest(t.last_test_date,b.start_date) ref) x on true;

-- ===== Pest control (weekly, Monday-Sunday IST; separate from Smoke Test) =====
create table public.pest_settings(id integer primary key default 1 check(id=1),record_type text not null default 'either' check(record_type in('inspection','treatment','either')),tracking_from date not null default ((clock_timestamp() at time zone 'Asia/Kolkata')::date),updated_at timestamptz not null default now());
insert into public.pest_settings default values;
create function public.set_pest_settings(p_record_type text) returns void language plpgsql security definer set search_path=public as $$begin
 if not is_admin() then raise exception 'Administrator access required';end if;
 if p_record_type not in('inspection','treatment','either') then raise exception 'Choose inspection, treatment or either';end if;
 update pest_settings set record_type=p_record_type,updated_at=clock_timestamp() where id=1;
 insert into audit_log(actor,action,after_value) values(auth.uid(),'set_pest_settings',jsonb_build_object('record_type',p_record_type));
end$$;
create table public.pest_checks(
 id uuid primary key default gen_random_uuid(),restaurant_id text not null references public.restaurants,done_date date not null,record_type text not null check(record_type in('inspection','treatment')),
 data jsonb not null default '{}',submitted_at timestamptz not null default clock_timestamp(),submitted_by uuid not null references public.profiles,submitted_by_name text not null
);
create index pest_checks_lookup on public.pest_checks(restaurant_id,done_date);
create trigger pest_checks_immutable before update or delete on public.pest_checks for each row execute function public.forbid_change();
create table public.pest_flags(restaurant_id text not null references public.restaurants,week_start date not null,flagged_at timestamptz not null default clock_timestamp(),primary key(restaurant_id,week_start));
create trigger pest_flags_immutable before delete on public.pest_flags for each row execute function public.forbid_change();
create function public.submit_pest_check(p_restaurant text,p_done_date date,p_type text,p_data jsonb) returns public.pest_checks language plpgsql security definer set search_path=public as $$
declare actor profiles;setting pest_settings;rec pest_checks;begin
 select * into actor from profiles where id=auth.uid() and active;
 if actor.id is null or actor.role='admin' or actor.restaurant_id is distinct from p_restaurant or not has_capability('pest_control') then raise exception 'You cannot file pest control for this outlet';end if;
 select * into setting from pest_settings where id=1;
 if p_done_date is null or p_done_date>ist_today() then raise exception 'The date cannot be in the future';end if;
 if p_type not in('inspection','treatment') or (setting.record_type<>'either' and p_type<>setting.record_type) then raise exception 'Record a % for pest control',setting.record_type;end if;
 if jsonb_typeof(coalesce(p_data,'{}'))<>'object' or octet_length(coalesce(p_data,'{}')::text)>32768 then raise exception 'Invalid pest control entry';end if;
 insert into pest_checks(restaurant_id,done_date,record_type,data,submitted_by,submitted_by_name) values(p_restaurant,p_done_date,p_type,coalesce(p_data,'{}'),actor.id,actor.name) returning * into rec;
 insert into audit_log(actor,action,restaurant_id,after_value) values(actor.id,'submit_pest_check',p_restaurant,jsonb_build_object('done_date',p_done_date,'type',p_type));
 return rec;
end$$;
create function public.check_pest_weeks() returns void language plpgsql security definer set search_path=public as $$
declare r record;w date;first_week date;this_week date:=date_trunc('week',ist_today())::date;t date;begin
 select tracking_from into t from pest_settings where id=1;
 first_week:=case when date_trunc('week',t)::date=t then t else date_trunc('week',t)::date+7 end;
 for r in select id from restaurants loop
  for w in select generate_series(first_week,this_week-7,interval '7 days')::date loop
   if not exists(select 1 from pest_checks where restaurant_id=r.id and done_date>=w and done_date<w+7) then
    insert into pest_flags(restaurant_id,week_start) values(r.id,w) on conflict do nothing;
   end if;
  end loop;
 end loop;
end$$;
create view public.pest_status with(security_invoker=true) as
 select r.id as restaurant_id,(select max(done_date) from pest_checks where restaurant_id=r.id) as last_done,
  exists(select 1 from pest_checks where restaurant_id=r.id and done_date>=date_trunc('week',ist_today())::date) as done_this_week,
  (select count(*)::int from pest_flags f where f.restaurant_id=r.id and not exists(select 1 from pest_checks c where c.restaurant_id=r.id and c.done_date>=f.week_start and c.done_date<f.week_start+7)) as open_flags,
  (select count(*)::int from pest_flags f where f.restaurant_id=r.id) as total_flags
 from restaurants r;

create function public.run_weekly_checks() returns void language plpgsql security definer set search_path=public as $$begin
 perform check_smoke_overdue(null);perform check_pest_weeks();
end$$;

-- ===== Access =====
do $$declare t text;begin foreach t in array array['smoke_tests','smoke_gaps','smoke_baselines','pest_checks','pest_flags'] loop
 execute format('alter table public.%I enable row level security',t);
 execute format('create policy scoped_read on public.%I for select to authenticated using(public.has_scope(restaurant_id))',t);
 execute format('grant select on public.%I to authenticated',t);
end loop;end$$;
alter table public.smoke_config enable row level security;alter table public.pest_settings enable row level security;alter table public.role_permissions enable row level security;
create policy read_all on public.smoke_config for select to authenticated using(true);
create policy read_all on public.pest_settings for select to authenticated using(true);
create policy read_all on public.role_permissions for select to authenticated using(true);
grant select on public.smoke_config,public.pest_settings,public.role_permissions,public.smoke_status,public.pest_status to authenticated;
revoke all on function public.has_capability(text),public.set_role_permission(text,text,boolean),public.reassign_outlet(uuid,text),public.reset_phone_credentials(uuid,uuid,text),public.provision_phone_employee(uuid,uuid,text,text,text,text,text,text),public.ist_today(),public.forbid_change(),public.guard_smoke_gaps(),public.set_smoke_config(jsonb),public.set_smoke_baseline(text,date),public.check_smoke_overdue(text),public.submit_smoke_test(text,date,jsonb),public.set_pest_settings(text),public.submit_pest_check(text,date,text,jsonb),public.check_pest_weeks(),public.run_weekly_checks() from public,anon,authenticated;
grant execute on function public.ist_today(),public.has_capability(text),public.set_role_permission(text,text,boolean),public.reassign_outlet(uuid,text),public.set_smoke_config(jsonb),public.set_smoke_baseline(text,date),public.submit_smoke_test(text,date,jsonb),public.set_pest_settings(text),public.submit_pest_check(text,date,text,jsonb) to authenticated;
grant execute on function public.reset_phone_credentials(uuid,uuid,text),public.provision_phone_employee(uuid,uuid,text,text,text,text,text,text),public.run_weekly_checks() to service_role;
