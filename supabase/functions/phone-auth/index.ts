import {createClient} from 'npm:@supabase/supabase-js@2';
import {normalizePhone,validatePin,validateNewPin,hashPin,verifyPin,hashActivationCode} from './validation.mjs';
const cors={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization,x-client-info,apikey,content-type','Access-Control-Allow-Methods':'POST,OPTIONS'};
const reply=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{...cors,'Content-Type':'application/json','Cache-Control':'no-store'}});
Deno.serve(async(req:Request)=>{
 if(req.method==='OPTIONS')return new Response('ok',{headers:cors});
 if(req.method!=='POST')return reply({error:'Method not allowed'},405);
 const url=Deno.env.get('SUPABASE_URL')!;
 const service=createClient(url,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,{auth:{persistSession:false,autoRefreshToken:false}});
 try{
  const raw=await req.text();if(raw.length>8192)return reply({error:'Request too large'},413);
  const input=JSON.parse(raw),action=input.action;
  if(!['login','activate','change_pin'].includes(action))return reply({error:'Invalid sign-in request'},400);
  let userId:string|undefined,phone:string;
  if(action==='change_pin'){
   const token=req.headers.get('Authorization')?.replace(/^Bearer\s+/i,'');
   const {data,error}=await service.auth.getUser(token||'');
   if(error||!data.user)return reply({error:'Sign in to change your PIN'},401);
   userId=data.user.id;
   const {data:profile}=await service.from('profiles').select('phone,active').eq('id',userId).single();
   if(!profile?.active||!profile.phone)return reply({error:'Active phone account required'},403);
   phone=profile.phone;validatePin(input.current_pin);validateNewPin(input.new_pin);
  }else{phone=normalizePhone(input.phone);validatePin(input.pin)}
  const phoneKey='phone:'+await hashActivationCode(phone);
  const {data:allowed,error:limitError}=await service.rpc('claim_auth_attempt',{p_key:phoneKey,p_limit:8});
  if(limitError)return reply({error:'Sign-in is temporarily unavailable'},503);
  const ip=req.headers.get('x-forwarded-for')?.split(',')[0]?.trim();
  const ipAllowed=ip?await service.rpc('claim_auth_attempt',{p_key:'ip:'+await hashActivationCode(ip),p_limit:50}):{data:true,error:null};
  if(!allowed||ipAllowed.error||!ipAllowed.data)return reply({error:'Too many attempts. Please wait 15 minutes before trying again.'},429);
  const {data:credentials}=await service.from('private_pin_credentials').select('*').eq('phone',phone).maybeSingle();
  const {data:profile}=await service.from('profiles').select('id,active').eq('phone',phone).maybeSingle();
  if(!credentials||!profile?.active||credentials.user_id!==profile.id){await hashPin(action==='change_pin'?input.current_pin:input.pin);return reply({error:'Invalid phone number, PIN or activation code.'},401)}
  if(action==='activate'){
   const code=String(input.activation_code||'').trim();if(code.length>128)return reply({error:'Invalid activation code'},400);
   validateNewPin(input.pin);
   const pin=await hashPin(input.pin);
   const {error}=await service.rpc('consume_phone_setup',{p_user:profile.id,p_code_hash:await hashActivationCode(code),p_pin_hash:pin.hash,p_salt:pin.salt});
   if(error)return reply({error:'Invalid or expired activation code. Ask your administrator for a new setup code.'},401);
  }else{
   if(!await verifyPin(action==='change_pin'?input.current_pin:input.pin,{hash:credentials.pin_hash,salt:credentials.pin_salt}))return reply({error:'Invalid phone number or PIN.'},401);
   if(action==='change_pin'){
    if(profile.id!==userId)return reply({error:'Account unavailable'},403);
    const pin=await hashPin(input.new_pin);
    const {error}=await service.rpc('change_phone_pin',{p_user:userId,p_previous_hash:credentials.pin_hash,p_new_hash:pin.hash,p_salt:pin.salt});
    if(error)return reply({error:'PIN could not be updated. Please try again.'},400);
    await service.from('private_auth_attempts').delete().eq('key',phoneKey);
    return reply({success:true});
   }
  }
  const {data:identity,error:userError}=await service.auth.admin.getUserById(profile.id);
  if(userError||!identity.user?.email)return reply({error:'Account setup is incomplete. Contact your administrator.'},400);
  // generateLink creates a server-side token only; no invitation or login email is sent.
  const {data:link,error:linkError}=await service.auth.admin.generateLink({type:'magiclink',email:identity.user.email});
  if(linkError||!link.properties?.hashed_token)return reply({error:'Could not start your session. Try again.'},503);
  const publicAuth=createClient(url,Deno.env.get('SUPABASE_ANON_KEY')!,{auth:{persistSession:false,autoRefreshToken:false}});
  const {data:session,error:sessionError}=await publicAuth.auth.verifyOtp({token_hash:link.properties.hashed_token,type:'magiclink'});
  if(sessionError||!session.session)return reply({error:'Could not start your session. Try again.'},503);
  await service.from('private_auth_attempts').delete().eq('key',phoneKey);
  return reply({session:session.session});
 }catch(e){return reply({error:e instanceof SyntaxError?'Invalid request':e instanceof Error?e.message:'Sign-in failed'},400)}
});
