import {createClient} from 'npm:@supabase/supabase-js@2';
import {employeeInput,requireAdmin} from './validation.mjs';
import {normalizePhone,makeActivationCode,hashActivationCode} from '../phone-auth/validation.mjs';
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
