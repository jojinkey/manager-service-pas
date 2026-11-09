import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';

const iso=(offset)=>new Date(Date.now()+5.5*3600e3+offset*86400e3).toISOString().slice(0,10);
const hash64='a'.repeat(64);

test('v3: scoring, roles, reassignment, credential reset, smoke test and pest control',async t=>{
 const db=new PGlite();t.after(()=>db.close());
 await db.exec(`create role anon;create role authenticated;create role service_role;
 create schema auth;create table auth.users(id uuid primary key);create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 grant usage on schema auth to authenticated;grant execute on function auth.uid() to authenticated;
 create schema storage;create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);create table storage.objects(id uuid,bucket_id text,name text);alter table storage.objects enable row level security;create function storage.foldername(text) returns text[] language sql as $$select string_to_array($1,'/')$$;`);
 for(const f of (await readdir('supabase/migrations')).sort())await db.exec(await readFile('supabase/migrations/'+f,'utf8'));
 await db.exec(await readFile('supabase/seed_templates.sql','utf8'));
 const ids={admin:'11111111-1111-4111-8111-111111111111',mgr:'22222222-2222-4222-8222-222222222222',chef:'33333333-3333-4333-8333-333333333333',staff:'44444444-4444-4444-8444-444444444444',other:'55555555-5555-4555-8555-555555555555'};
 await db.query('insert into auth.users values($1),($2),($3),($4),($5)',Object.values(ids));
 await db.query(`insert into profiles(id,name,role,restaurant_id,phone) values($1,'Admin','admin',null,null),($2,'Mgr','manager','kampai','+919800000001'),($3,'Chef','chef','kampai','+919800000002'),($4,'Staff','staff','kampai','+919800000003'),($5,'Other','manager','basque','+919800000004')`,Object.values(ids));
 const as=async(id,fn)=>{await db.exec('set role authenticated');await db.query("select set_config('request.jwt.claim.sub',$1,false)",[id]);try{return await fn()}finally{await db.exec('reset role')}};
 const q=(sql,a=[])=>db.query(sql,a);
 const scalar=async(sql,a=[])=>Object.values((await q(sql,a)).rows[0])[0];
 const smoke=(who,r,d,data={result:'pass'})=>as(who,()=>q('select submit_smoke_test($1,$2,$3)',[r,d,data]));
 const gaps=async(r)=>(await q("select from_date::text f,to_date::text t,days,resolved_at is not null r from smoke_gaps where restaurant_id=$1 order by from_date",[r])).rows;

 await t.test('roles: chef and staff exist and need an outlet',async()=>{
  assert.equal(await scalar("select count(*)::int from profiles where role in('chef','staff')"),2);
  await assert.rejects(()=>q("insert into profiles(id,name,role) values(gen_random_uuid(),'x','chef')"));
 });

 let pol;
 await t.test('scoring: 200 start, +5 capped at 200, -20 per miss, once per report',async()=>{
  const pts=()=>scalar('select points from current_score_totals where manager_id=$1',[ids.mgr]);
  assert.equal(await pts(),200);
  assert.equal(await scalar("select minimum_benchmark from score_settings where restaurant_id='kampai'"),140);
  assert.equal(await scalar("select reset_every_days from score_settings where restaurant_id='kampai'"),15);
  pol=(await q(`insert into policies(restaurant_id,type,version,enabled,start_time,end_time,timezone,manager_id,reward,missed_penalty,effective_from,operating_days) values('kampai','closing',1,true,'21:00','11:30','Asia/Kolkata',$1,5,20,current_date,'{0,1,2,3,4,5,6}') returning id`,[ids.mgr])).rows[0].id;
  let n=0;
  const occ=async(reason)=>{
   const o=(await q(`insert into occurrences(restaurant_id,type,business_date,shift,manager_id,policy_id,policy_snapshot,opens_at,deadline) values('kampai','closing',$1,'Evening',$2,$3,'{}',clock_timestamp()-interval '2 hours',clock_timestamp()-interval '1 hour') returning id`,[new Date(Date.UTC(2041,0,++n)).toISOString().slice(0,10),ids.mgr,pol])).rows[0].id;
   await q('select record_score(o,$2) from occurrences o where id=$1',[o,reason]);await q('select record_score(o,$2) from occurrences o where id=$1',[o,reason]);
  };
  await occ('submitted');assert.equal(await pts(),200,'cap');
  for(let i=0;i<4;i++)await occ('missed');
  assert.equal(await pts(),120,'4 misses = -80, never double counted');
  assert.equal(await scalar("select count(*)::int from score_alerts where manager_id=$1 and kind='below_benchmark' and active",[ids.mgr]),1,'instant alert below 140');
  assert.equal(await scalar("select count(*)::int from score_alerts where kind='below_benchmark' and active"),1);
  await occ('submitted');assert.equal(await pts(),125);
  const ledger=await scalar('select count(*)::int from score_ledger');
  await as(ids.admin,()=>q("select reset_points('kampai')"));
  assert.equal(await pts(),200,'reset restores 200');
  assert.equal(await scalar('select count(*)::int from score_ledger'),ledger,'history kept');
 });

 await t.test('permissions are admin-configurable',async()=>{
  await assert.rejects(()=>as(ids.mgr,()=>q("select set_role_permission('staff','smoke_test',true)")),/Administrator/);
  await as(ids.admin,()=>q("select set_role_permission('staff','smoke_test',true)"));
  assert.equal(await as(ids.staff,()=>scalar("select has_capability('smoke_test')")),true);
  await as(ids.admin,()=>q("select set_role_permission('staff','smoke_test',false)"));
  assert.equal(await as(ids.staff,()=>scalar("select has_capability('smoke_test')")),false);
 });

 await t.test('smoke: first run shows none and fires no alert',async()=>{
  assert.equal(await scalar("select status from smoke_status where restaurant_id='kampai'"),'none');
  await q('select run_weekly_checks()');
  assert.equal(await scalar('select count(*)::int from smoke_gaps'),0);
  await assert.rejects(()=>as(ids.admin,()=>q("select set_smoke_baseline('kampai',$1)",[iso(1)])),/future/);
 });

 await t.test('smoke: access, future dates rejected, entries immutable',async()=>{
  await assert.rejects(()=>smoke(ids.staff,'kampai',iso(0)),/cannot file/);
  await assert.rejects(()=>smoke(ids.other,'kampai',iso(0)),/cannot file/);
  await assert.rejects(()=>smoke(ids.admin,'kampai',iso(0)),/cannot file/);
  await assert.rejects(()=>smoke(ids.mgr,'kampai',iso(1)),/future/);
  await assert.rejects(()=>smoke(ids.mgr,'kampai',iso(0),{notes:'x'}),/Complete/);
  await smoke(ids.mgr,'kampai',iso(0));
  const today=(await q('select * from smoke_tests where test_date=$1',[iso(0)])).rows[0];
  assert.equal(today.late,false);
  await smoke(ids.chef,'kampai',iso(-10));
  const e=(await q('select * from smoke_tests where test_date=$1',[iso(-10)])).rows[0];
  assert.equal(e.late,true);assert.ok(e.submitted_at);assert.equal(e.submitted_by_name,'Chef');
  await assert.rejects(()=>smoke(ids.chef,'kampai',iso(-10)),/already/);
  await assert.rejects(()=>q('update smoke_tests set late=false'),/immutable/);
  await assert.rejects(()=>q('delete from smoke_tests'),/immutable/);
 });

 await t.test('smoke: a backdated entry cannot erase a gap >7 days; retained forever',async()=>{
  // Tests exist on day 0 and day -10: the 10-day gap is recorded when the late entry arrives.
  const g=await gaps('kampai');
  assert.deepEqual(g,[{f:iso(-10),t:iso(0),days:10,r:true}]);
  await assert.rejects(()=>q('delete from smoke_gaps'),/permanent/);
  await assert.rejects(()=>q("update smoke_gaps set days=1"),/closed gap/);
  await smoke(ids.mgr,'kampai',iso(-5)); // inside the old gap: old record is untouched
  assert.deepEqual(await gaps('kampai'),g);
 });

 await t.test('smoke: exactly 7 days is not overdue; 8 days gives one alert (job, no login)',async()=>{
  await as(ids.admin,()=>q("select set_smoke_baseline('embassy-vasant',$1)",[iso(-7)]));
  assert.equal(await scalar("select status from smoke_status where restaurant_id='embassy-vasant'"),'ok');
  assert.equal(await scalar("select days_since from smoke_status where restaurant_id='embassy-vasant'"),7);
  await as(ids.admin,()=>q("select set_smoke_baseline('embassy-elan',$1)",[iso(-8)]));
  await q('select run_weekly_checks()');await q('select run_weekly_checks()');
  assert.equal(await scalar("select count(*)::int from smoke_gaps where restaurant_id='embassy-vasant'"),0);
  assert.equal(await scalar("select count(*)::int from smoke_gaps where restaurant_id='embassy-elan'"),1,'one alert, no daily stacking');
  assert.equal(await scalar("select status from smoke_status where restaurant_id='embassy-elan'"),'overdue');
 });

 await t.test('smoke: admin-edited checklist applies; smoke does not touch points',async()=>{
  const before=await scalar('select count(*)::int from score_ledger');
  await as(ids.admin,()=>q('select set_smoke_config($1)',[JSON.stringify([{id:'temp',label:'Temperature',type:'number',required:true}])]));
  await assert.rejects(()=>smoke(ids.other,'basque',iso(0),{temp:'hot'}),/number/);
  await smoke(ids.other,'basque',iso(0),{temp:'21.5'});
  assert.equal(await scalar('select count(*)::int from score_ledger'),before);
 });

 await t.test('pest control: weekly, flagged when a week is missed, flags kept',async()=>{
  await assert.rejects(()=>as(ids.mgr,()=>q("select submit_pest_check('kampai',$1,'inspection','{}')",[iso(1)])),/future/);
  await as(ids.admin,()=>q("select set_pest_settings('treatment')"));
  await assert.rejects(()=>as(ids.mgr,()=>q("select submit_pest_check('kampai',$1,'inspection','{}')",[iso(0)])),/treatment/);
  await as(ids.admin,()=>q("select set_pest_settings('either')"));
  await q('update pest_settings set tracking_from=$1',[iso(-28)]);
  await q('select run_weekly_checks()');await q('select run_weekly_checks()');
  const total=await scalar("select total_flags from pest_status where restaurant_id='basque'");
  assert.ok(total>=3);
  const week=await scalar("select min(week_start)::text from pest_flags where restaurant_id='basque'");
  await as(ids.other,()=>q("select submit_pest_check('basque',$1,'inspection','{}')",[week]));
  assert.equal(await scalar("select open_flags from pest_status where restaurant_id='basque'"),total-1);
  assert.equal(await scalar("select total_flags from pest_status where restaurant_id='basque'"),total,'flag history retained');
  await assert.rejects(()=>q('delete from pest_flags'),/immutable/);
 });

 await t.test('reassignment: history stays with Kampai, manager now sees only Basque',async()=>{
  await assert.rejects(()=>as(ids.mgr,()=>q("select reassign_outlet($1,'basque')",[ids.mgr])),/Administrator/);
  const kampaiLedger=await scalar("select count(*)::int from score_ledger where restaurant_id='kampai'");
  const kampaiSmoke=await scalar("select count(*)::int from smoke_tests where restaurant_id='kampai'");
  assert.ok(kampaiLedger>0&&kampaiSmoke>0);
  assert.equal(await as(ids.mgr,()=>scalar("select count(*)::int from smoke_tests where restaurant_id='kampai'")),kampaiSmoke,'before: sees Kampai');
  await q("insert into assignment_history(user_id,restaurant_id) values($1,'kampai')",[ids.mgr]);
  await as(ids.admin,()=>q("select reassign_outlet($1,'basque')",[ids.mgr]));
  assert.equal(await scalar("select restaurant_id from profiles where id=$1",[ids.mgr]),'basque');
  assert.equal(await scalar("select count(*)::int from score_ledger where restaurant_id='kampai'"),kampaiLedger,'ledger unchanged');
  assert.equal(await scalar("select count(*)::int from smoke_tests where restaurant_id='kampai' and test_date=$1",[iso(0)]),1,'original date kept');
  assert.equal(await scalar("select count(*)::int from smoke_tests where submitted_by=$1 and restaurant_id='kampai'",[ids.mgr]) > 0,true);
  assert.equal(await as(ids.mgr,()=>scalar("select count(*)::int from smoke_tests where restaurant_id='kampai'")),0,'after: cannot read Kampai');
  assert.equal(await scalar('select enabled from policies where id=$1',[pol]),false,'old schedule stopped');
  await assert.rejects(()=>smoke(ids.mgr,'kampai',iso(-2)),/cannot file/);
  await assert.rejects(()=>as(ids.admin,()=>q("select reassign_outlet($1,'basque')",[ids.mgr])),/Already/);
  assert.equal(await scalar('select count(*)::int from assignment_history where user_id=$1',[ids.mgr]),2);
 });

 await t.test('credential reset: old PIN removed, person must set a new one, admin cannot read it',async()=>{
  await q("insert into private_pin_credentials(user_id,phone,pin_hash,pin_salt) values($1,'+919800000001',$2,$3)",[ids.mgr,'b'.repeat(64),'s'.repeat(40)]);
  await assert.rejects(()=>q('select reset_phone_credentials($1,$2,$3)',[ids.mgr,ids.chef,hash64]),/Administrator/);
  await assert.rejects(()=>q('select reset_phone_credentials($1,$2,$3)',[ids.admin,ids.admin,hash64]),/employee/);
  await q('select reset_phone_credentials($1,$2,$3)',[ids.admin,ids.mgr,hash64]);
  const c=(await q('select * from private_pin_credentials where user_id=$1',[ids.mgr])).rows[0];
  assert.equal(c.pin_hash,null);assert.equal(c.activation_hash,hash64);
  assert.equal(await scalar('select pin_ready from profiles where id=$1',[ids.mgr]),false);
  await q('select consume_phone_setup($1,$2,$3,$4)',[ids.mgr,hash64,'c'.repeat(64),'s'.repeat(40)]);
  assert.equal(await scalar('select pin_ready from profiles where id=$1',[ids.mgr]),true);
 });

 await t.test('chef and staff can be provisioned',async()=>{
  const id='66666666-6666-4666-8666-666666666666';
  await q('insert into auth.users values($1)',[id]);
  await q("select provision_phone_employee($1,$2,'New Chef','n@accounts.invalid','basque','+919811111111',$3,'chef')",[ids.admin,id,hash64]);
  assert.equal(await scalar('select role from profiles where id=$1',[id]),'chef');
  await assert.rejects(()=>q("select provision_phone_employee($1,gen_random_uuid(),'Bad Role','b@accounts.invalid','basque','+919822222222',$2,'owner')",[ids.admin,hash64]),/manager, chef or staff/);
 });
});

test('admin can add or deduct a manager points with a recorded reason', async (tc) => {
 const db = new PGlite(); tc.after(() => db.close());
 await db.exec(`create role anon;create role authenticated;create role service_role;
 create schema auth;create table auth.users(id uuid primary key);create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 grant usage on schema auth to authenticated;grant execute on function auth.uid() to authenticated;
 create schema storage;create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);create table storage.objects(id uuid,bucket_id text,name text);alter table storage.objects enable row level security;create function storage.foldername(text) returns text[] language sql as $$select string_to_array($1,'/')$$;`);
 for (const f of (await readdir('supabase/migrations')).sort()) await db.exec(await readFile('supabase/migrations/' + f, 'utf8'));
 const A = '11111111-1111-4111-8111-111111111111', M = '22222222-2222-4222-8222-222222222222', C = '33333333-3333-4333-8333-333333333333';
 await db.query('insert into auth.users values($1),($2),($3)', [A, M, C]);
 await db.query("insert into profiles(id,name,role,restaurant_id) values($1,'Admin','admin',null),($2,'Mgr','manager','kampai'),($3,'Chef','chef','kampai')", [A, M, C]);
 const as = async (id, fn) => { await db.exec('set role authenticated'); await db.query("select set_config('request.jwt.claim.sub',$1,false)", [id]); try { return await fn(); } finally { await db.exec('reset role'); } };
 const pts = async () => (await db.query('select points from current_score_totals where manager_id=$1', [M])).rows[0].points;
 const adjust = (who, u, n, note = 'Test reason') => as(who, () => db.query('select adjust_points($1,$2,$3) r', [u, n, note]));
 await assert.rejects(() => adjust(M, M, 10), /Administrator/);
 await assert.rejects(() => adjust(A, C, -10), /active manager/);
 await assert.rejects(() => adjust(A, M, 0), /between/);
 await assert.rejects(() => adjust(A, M, -5, ''), /reason/);
 await assert.rejects(() => adjust(A, M, 10), /maximum/);
 await adjust(A, M, -30, 'Late stock count'); assert.equal(await pts(), 170);
 assert.equal((await adjust(A, M, 50, 'Goodwill')).rows[0].r, 30, 'capped at 200'); assert.equal(await pts(), 200);
 await adjust(A, M, -70, 'Hygiene breach'); assert.equal(await pts(), 130);
 assert.equal((await db.query("select count(*)::int n from score_alerts where kind='below_benchmark' and active and manager_id=$1", [M])).rows[0].n, 1, 'benchmark alert fires');
 const row = (await db.query("select adjusted_by,note from score_ledger where reason='adjustment' order by created_at desc limit 1")).rows[0];
 assert.equal(row.adjusted_by, A); assert.equal(row.note, 'Hygiene breach');
 assert.equal((await db.query("select count(*)::int n from audit_log where action='adjust_points'")).rows[0].n, 3);
});

test('migration 012: points restart at 200, default windows, employee removal', async (tc) => {
 const db = new PGlite(); tc.after(() => db.close());
 await db.exec(`create role anon;create role authenticated;create role service_role;
 create schema auth;create table auth.users(id uuid primary key);create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 grant usage on schema auth to authenticated;grant execute on function auth.uid() to authenticated;
 create schema storage;create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);create table storage.objects(id uuid,bucket_id text,name text);alter table storage.objects enable row level security;create function storage.foldername(text) returns text[] language sql as $$select string_to_array($1,'/')$$;`);
 const files = (await readdir('supabase/migrations')).sort();
 const before012 = files.filter((f) => f < '012');
 for (const f of before012) await db.exec(await readFile('supabase/migrations/' + f, 'utf8'));
 const A = '11111111-1111-4111-8111-111111111111', M = '22222222-2222-4222-8222-222222222222', X = '33333333-3333-4333-8333-333333333333', Y = '44444444-4444-4444-8444-444444444444';
 await db.query('insert into auth.users values($1),($2),($3),($4)', [A, M, X, Y]);
 await db.query("insert into profiles(id,name,role,restaurant_id,phone,active) values($1,'Admin','admin',null,null,true),($2,'Mgr','manager','kampai','+919800000001',true),($3,'Fresh','chef','kampai','+919800000002',true),($4,'Used','staff','kampai','+919800000003',true)", [A, M, X, Y]);
 // existing policies on the old windows + a pending overnight occurrence and one already open
 const mk = async (type, s, e) => (await db.query("insert into policies(restaurant_id,type,version,enabled,start_time,end_time,timezone,manager_id,reward,missed_penalty,effective_from,operating_days) values('kampai',$1,1,true,$2,$3,'Asia/Kolkata',$4,5,20,current_date,'{0,1,2,3,4,5,6}') returning id", [type, s, e, M])).rows[0].id;
 const open = await mk('opening', '11:30', '14:33'), clos = await mk('closing', '21:00', '11:30');
 const occ = async (pol, type, date, off) => (await db.query("insert into occurrences(restaurant_id,type,business_date,shift,manager_id,policy_id,policy_snapshot,opens_at,deadline) values('kampai',$1,$2,'Evening',$3,$4,'{}',clock_timestamp()+($5||' hours')::interval,clock_timestamp()+($5||' hours')::interval+interval '10 hours') returning id", [type, date, M, pol, off])).rows[0].id;
 const futureOcc = await occ(clos, 'closing', '2041-03-10', '5'), openOcc = await occ(open, 'opening', '2041-03-09', '-1');
 await db.query("insert into score_ledger(restaurant_id,manager_id,cycle_id,business_date,reason,amount,occurrence_id,policy_id) select 'kampai',$1,current_cycle_id,current_date,'missed',-60,$2,$3 from score_settings where restaurant_id='kampai'", [M, openOcc, open]);
 const pts = async () => (await db.query('select points from current_score_totals where manager_id=$1', [M])).rows[0].points;
 assert.equal(await pts(), 140);
 await db.exec(await readFile('supabase/migrations/012_cycle_restart_default_windows_remove_employee.sql', 'utf8'));

 // 1) points restart
 assert.equal(await pts(), 200, 'everyone back to 200');
 assert.equal((await db.query("select count(*)::int n from score_ledger")).rows[0].n, 1, 'ledger history kept');
 assert.equal((await db.query("select extract(epoch from ends_at-starts_at)/86400 d from score_cycles c join score_settings s on s.current_cycle_id=c.id where s.restaurant_id='kampai'")).rows[0].d, '15.0000000000000000');
 assert.equal((await db.query("select count(*)::int n from score_alerts where active")).rows[0].n, 0);

 // 2) windows: new versions, only not-yet-open occurrences move, overnight maths holds
 const cur = (await db.query("select type,start_time::text s,end_time::text e,version from policies where current order by type")).rows;
 assert.deepEqual(cur, [{ type: 'opening', s: '11:30:00', e: '14:30:00', version: 2 }, { type: 'closing', s: '22:30:00', e: '11:30:00', version: 2 }]);
 const f = (await db.query("select (opens_at at time zone 'Asia/Kolkata')::text o,(deadline at time zone 'Asia/Kolkata')::text d from occurrences where id=$1", [futureOcc])).rows[0];
 assert.equal(f.o, '2041-03-10 22:30:00'); assert.equal(f.d, '2041-03-11 11:30:00', 'closing for the 10th ends next morning');
 const o = (await db.query("select policy_id from occurrences where id=$1", [openOcc])).rows[0];
 assert.equal(o.policy_id, open, 'already-open report keeps its original window and policy');
 assert.equal((await db.query("select count(*)::int n from policies where current and restaurant_id='kampai'")).rows[0].n, 2);

 // 3) removal
 const rm = (who, u) => db.query('select remove_employee($1,$2) r', [who, u]);
 await assert.rejects(() => rm(M, X), /Administrator/);
 await assert.rejects(() => rm(A, A), /own account/);
 assert.equal((await rm(A, X)).rows[0].r, 'deleted');
 assert.equal((await db.query('select count(*)::int n from profiles where id=$1', [X])).rows[0].n, 0);
 await db.query("insert into private_pin_credentials(user_id,phone,pin_hash,pin_salt) values($1,'+919800000003',$2,$3)", [Y, 'b'.repeat(64), 's'.repeat(40)]);
 await db.query("insert into audit_log(actor,action) values($1,'set_initial_pin')", [Y]);
 assert.equal((await rm(A, Y)).rows[0].r, 'archived');
 const y = (await db.query('select active,phone,removed_at is not null r,name from profiles where id=$1', [Y])).rows[0];
 assert.deepEqual(y, { active: false, phone: null, r: true, name: 'Used' });
 assert.equal((await db.query('select count(*)::int n from private_pin_credentials where user_id=$1', [Y])).rows[0].n, 0);
 await assert.rejects(() => rm(A, Y), /unavailable/);
});

test('migration 013: every outlet gets four active policies with its manager', async (tc) => {
 const db = new PGlite(); tc.after(() => db.close());
 await db.exec(`create role anon;create role authenticated;create role service_role;
 create schema auth;create table auth.users(id uuid primary key);create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 grant usage on schema auth to authenticated;grant execute on function auth.uid() to authenticated;
 create schema storage;create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);create table storage.objects(id uuid,bucket_id text,name text);alter table storage.objects enable row level security;create function storage.foldername(text) returns text[] language sql as $$select string_to_array($1,'/')$$;`);
 for (const f of (await readdir('supabase/migrations')).sort()) await db.exec(await readFile('supabase/migrations/' + f, 'utf8'));
 const M = '22222222-2222-4222-8222-222222222222';
 await db.query('insert into auth.users values($1)', [M]);
 await db.query("insert into profiles(id,name,role,restaurant_id,active) values($1,'Mgr','manager','kampai',true)", [M]);
 const sql = await readFile('supabase/migrations/013_activate_all_policies.sql', 'utf8');
 await db.exec(sql);
 const k = (await db.query("select type,enabled,manager_id,start_time::text s,end_time::text e,effective_from=public.ist_today() today from policies where restaurant_id='kampai' and current order by type")).rows;
 assert.equal(k.length, 4);
 assert.ok(k.every((r) => r.enabled && r.manager_id === M && r.today));
 assert.equal(k.find((r) => r.type === 'opening').s, '11:30:00');
 assert.equal(k.find((r) => r.type === 'closing').s, '22:30:00');
 assert.equal((await db.query("select count(*)::int n from policies where enabled and restaurant_id<>'kampai'")).rows[0].n, 0, 'outlets without a manager stay off');
 await db.exec(sql);
 assert.equal((await db.query("select count(*)::int n from policies where restaurant_id='kampai'")).rows[0].n, 4, 'safe to re-run');
});

test('migration 014: opening deadline 3:30 pm and one-day extensions', async (tc) => {
 const db = new PGlite(); tc.after(() => db.close());
 await db.exec(`create role anon;create role authenticated;create role service_role;
 create schema auth;create table auth.users(id uuid primary key);create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 grant usage on schema auth to authenticated;grant execute on function auth.uid() to authenticated;
 create schema storage;create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);create table storage.objects(id uuid,bucket_id text,name text);alter table storage.objects enable row level security;create function storage.foldername(text) returns text[] language sql as $$select string_to_array($1,'/')$$;`);
 const files = (await readdir('supabase/migrations')).sort();
 for (const f of files.filter((f) => f < '014')) await db.exec(await readFile('supabase/migrations/' + f, 'utf8'));
 const A = '11111111-1111-4111-8111-111111111111', M = '22222222-2222-4222-8222-222222222222';
 await db.query('insert into auth.users values($1),($2)', [A, M]);
 await db.query("insert into profiles(id,name,role,restaurant_id,active) values($1,'Admin','admin',null,true),($2,'Mgr','manager','kampai',true)", [A, M]);
 await db.exec(await readFile('supabase/migrations/013_activate_all_policies.sql', 'utf8'));
 const pol = (await db.query("select id from policies where restaurant_id='kampai' and type='opening' and current")).rows[0].id;
 const occ = async (date, o, d) => (await db.query("insert into occurrences(restaurant_id,type,business_date,shift,manager_id,policy_id,policy_snapshot,opens_at,deadline) values('kampai','opening',$1,'Morning',$2,$3,'{\"timezone\":\"Asia/Kolkata\"}',clock_timestamp()+($4||' hours')::interval,clock_timestamp()+($5||' hours')::interval) returning id", [date, M, pol, o, d])).rows[0].id;
 const open = await occ('2041-03-09', '-1', '2'), later = await occ('2041-03-10', '5', '8');
 await db.exec(await readFile('supabase/migrations/014_opening_deadline_and_day_extensions.sql', 'utf8'));
 const cur = (await db.query("select start_time::text s,end_time::text e from policies where restaurant_id='kampai' and type='opening' and current")).rows[0];
 assert.deepEqual(cur, { s: '11:30:00', e: '15:30:00' });
 const dl = (await db.query("select (deadline at time zone 'Asia/Kolkata')::text d from occurrences where id=$1", [later])).rows[0].d;
 assert.equal(dl, '2041-03-10 15:30:00', 'pending opening report moves to 3:30 pm');
 const as = async (id, fn) => { await db.exec('set role authenticated'); await db.query("select set_config('request.jwt.claim.sub',$1,false)", [id]); try { return await fn(); } finally { await db.exec('reset role'); } };
 const ext = (who, id, time) => as(who, () => db.query('select extend_report_deadline($1,$2) r', [id, time]));
 await assert.rejects(() => ext(M, open, '23:59'), /Administrator/);
 await ext(A, open, '23:59');
 const nd = (await db.query("select (deadline at time zone 'Asia/Kolkata')::time::text d from occurrences where id=$1", [open])).rows[0].d;
 assert.equal(nd, '23:59:00');
 assert.equal((await db.query("select count(*)::int n from audit_log where action='extend_report_deadline'")).rows[0].n, 1);
 await db.query("update occurrences set missed_at=clock_timestamp() where id=$1", [later]);
 await assert.rejects(() => ext(A, later, '23:59'), /already marked missed/);
});
