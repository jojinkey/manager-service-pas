function normalizePhone(value) {
 const raw=String(value||'').trim();if(!/^[+\d\s()-]+$/.test(raw))throw Error('Enter a valid phone number.');
 let digits=raw.replace(/\D/g,'');
 if(digits.length===10&&!raw.startsWith('+'))digits='91'+digits;
 if(!/^[1-9]\d{7,14}$/.test(digits))throw Error('Enter a valid phone number with country code.');
 return '+'+digits;
}
function validatePin(value) {
 if(typeof value!=='string'||!/^\d{4}$/.test(value))throw Error('Choose a PIN with exactly four digits.');
 return value;
}
const weakPins=new Set(['0000','1111','2222','3333','4444','5555','6666','7777','8888','9999','1234','4321','2345','3456','4567','5678','6789','0123','1212','2580','1122','1004']);
// Applies only when choosing a PIN, never at sign-in, so existing users are not locked out.
function validateNewPin(value) {
 validatePin(value);
 if(weakPins.has(value))throw Error('That PIN is too easy to guess. Choose a different four digits.');
 return value;
}
function makeActivationCode() {
 return Array.from(crypto.getRandomValues(new Uint8Array(18)),v=>v.toString(16).padStart(2,'0')).join('');
}
async function hashActivationCode(value) {
 return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value))),v=>v.toString(16).padStart(2,'0')).join('');
}
async function hashPin(pin,salt=makeActivationCode()) {
 validatePin(pin);
 const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(pin),'PBKDF2',false,['deriveBits']);
 const bits=await crypto.subtle.deriveBits({name:'PBKDF2',salt:new TextEncoder().encode(salt),iterations:210000,hash:'SHA-256'},key,256);
 return {salt,hash:Array.from(new Uint8Array(bits),v=>v.toString(16).padStart(2,'0')).join('')};
}
async function verifyPin(pin,stored) {
 if(!stored?.hash||!stored?.salt||typeof pin!=='string'||!/^\d{4}$/.test(pin))return false;
 const next=await hashPin(pin,stored.salt);let difference=next.hash.length^stored.hash.length;
 for(let i=0;i<next.hash.length;i++)difference|=next.hash.charCodeAt(i)^(stored.hash.charCodeAt(i)||0);
 return difference===0;
}

function requireAdmin(profile) {
 if(!profile||profile.role!=='admin'||profile.active===false)throw Error('Administrator access required');
 return profile.id;
}
function employeeInput(body) {
 const name=String(body?.name||'').trim(),phone=normalizePhone(body?.phone),restaurant_id=body?.restaurant_id,role=body?.role||'manager';
 if(!['manager','chef','staff'].includes(role))throw Error('Choose manager, chef or staff. Admin access cannot be granted here.');
 if(name.length<2||name.length>120)throw Error('Enter an employee name between 2 and 120 characters.');
 if(body?.pin!==undefined||body?.password!==undefined)throw Error('The employee chooses their own PIN using an activation code.');
 if(!['embassy-vasant','embassy-elan','kampai','basque'].includes(restaurant_id))throw Error('Choose one of the four restaurants.');
 return {name,phone,restaurant_id,role};
}

import {createClient} from 'npm:@supabase/supabase-js@2';
const cors={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization,x-client-info,apikey,content-type','Access-Control-Allow-Methods':'POST,OPTIONS'};
const reply=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{...cors,'Content-Type':'application/json','Cache-Control':'no-store'}});
Deno.serve(async(req:Request)=>{
 if(req.method==='OPTIONS')return new Response('ok',{headers:cors});
 if(req.method!=='POST')return reply({error:'Method not allowed'},405);
 const service=createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,{auth:{persistSession:false,autoRefreshToken:false}});
 const token=req.headers.get('Authorization')?.replace(/^Bearer\s+/i,'');
 const {data:identity,error:authError}=await service.auth.getUser(token||'');
 if(authError||!identity.user)return reply({error:'Your session expired. Sign in again.'},401);
 const {data:actor}=await service.from('profiles').select('id,role,active').eq('id',identity.user.id).single();
 try{requireAdmin(actor)}catch{return reply({error:'Administrator access required'},403)}
 try{
  const raw=await req.text();if(raw.length>16384)return reply({error:'Request is too large'},413);
  const body=JSON.parse(raw),code=makeActivationCode(),codeHash=await hashActivationCode(code);
  if(body.action==='issue_setup'){
   const phone=normalizePhone(body.phone);
   const {error}=await service.rpc('issue_phone_setup',{p_actor:actor!.id,p_user:body.user_id,p_phone:phone,p_hash:codeHash});
   if(error)return reply({error:error.message},400);
   return reply({activation_code:code,expires_in_hours:24,phone});
  }
  if(body.action==='reset_credentials'){
   const {error}=await service.rpc('reset_phone_credentials',{p_actor:actor!.id,p_user:body.user_id,p_hash:codeHash});
   if(error)return reply({error:error.message},400);
   return reply({activation_code:code,expires_in_hours:24,must_set_new_pin:true});
  }
  const input=employeeInput(body),email=crypto.randomUUID()+'@accounts.service.invalid';
  const {data:created,error}=await service.auth.admin.createUser({email,password:makeActivationCode()+makeActivationCode(),email_confirm:true,user_metadata:{full_name:input.name}});
  if(error||!created.user)return reply({error:'Could not create this employee.'},400);
  const {error:setupError}=await service.rpc('provision_phone_employee',{p_actor:actor!.id,p_user:created.user.id,p_name:input.name,p_email:email,p_restaurant:input.restaurant_id,p_phone:input.phone,p_hash:codeHash,p_role:input.role});
  if(setupError){await service.auth.admin.deleteUser(created.user.id);return reply({error:'Employee setup failed. Check whether this phone number already has an account.'},400)}
  return reply({employee:{id:created.user.id,name:input.name,phone:input.phone,restaurant_id:input.restaurant_id,role:input.role},activation_code:code,expires_in_hours:24});
 }catch(e){return reply({error:e instanceof Error?e.message:'Invalid employee details'},400)}
});
