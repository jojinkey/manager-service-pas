import { createClient } from "@supabase/supabase-js";
import { readPages } from "./pagination.mjs";
const url = import.meta.env.VITE_SUPABASE_URL,
  key = import.meta.env.VITE_SUPABASE_ANON_KEY;
export const supabase = url && key ? createClient(url, key) : null;
export async function signIn(email, password) {
  if (!supabase)
    throw Error(
      "The database connection is not configured. Contact your administrator.",
    );
  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password,
  });
  if (error) {
    if (/fetch|network/i.test(error.message))
      throw new Error(
        "Cannot reach the server. Check your connection and try again.",
      );
    throw error;
  }
  const { data: profile, error: err } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", data.user.id)
    .single();
  if (err || !profile?.active || profile?.role!=='admin') {
    await supabase.auth.signOut({ scope: "local" });
    throw new Error(
      !profile?.active ? 'This account is deactivated. Contact your administrator.' : profile?.role!=='admin' ? 'Managers sign in with phone number and PIN.' : err?.code === "PGRST116"
        ? "This account has no workspace assignment. Contact your administrator."
        : err?.message || 'Account unavailable',
    );
  }
  return profile;
}
export async function readTable(table) {
  const byKey={score_settings:'restaurant_id',current_score_totals:'manager_id',smoke_status:'restaurant_id',pest_status:'restaurant_id',smoke_baselines:'restaurant_id',role_permissions:'role,capability',pest_flags:'restaurant_id,week_start'};
  const order = byKey[table]||'id';
  return readPages((from,to) => supabase.from(table).select("*").order(order).range(from,to));
}
export async function rpc(name, args) {
  const { data, error } = await supabase.rpc(name, args);
  if (error) throw error;
  return data;
}
export async function createEmployee(input) {
  const { data, error } = await supabase.functions.invoke("employee-admin", {
    body: input,
  });
  if (error) {
    let message = error.message;
    try {
      const body = await error.context.json();
      message = body.error || message;
    } catch {}
    throw new Error(message);
  }
  if (data?.error) throw new Error(data.error);
  return data;
}
export async function phoneRequest(body) {
 const {data,error}=await supabase.functions.invoke('phone-auth',{body});
 if(error){let message=error.message;try{message=(await error.context.json()).error||message}catch{}throw Error(message)}
 if(data?.error)throw Error(data.error);return data;
}
export async function signInPhone(phone,pin,activationCode) {
 const data=await phoneRequest({action:activationCode?'activate':'login',phone,pin,...(activationCode?{activation_code:activationCode}:{})});
 const {error}=await supabase.auth.setSession({access_token:data.session.access_token,refresh_token:data.session.refresh_token});if(error)throw error;
 const {data:profile,error:profileError}=await supabase.from('profiles').select('*').eq('id',data.session.user.id).single();
 if(profileError||!profile?.active){await supabase.auth.signOut({scope:'local'});throw Error('Account unavailable or deactivated. Contact your administrator.')}
 return profile;
}
export async function issuePhoneSetup(user_id,phone) {
 const {data,error}=await supabase.functions.invoke('employee-admin',{body:{action:'issue_setup',user_id,phone}});
 if(error){let message=error.message;try{message=(await error.context.json()).error||message}catch{}throw Error(message)}
 if(data?.error)throw Error(data.error);return data;
}
export async function resetCredentials(user_id) {
 const {data,error}=await supabase.functions.invoke('employee-admin',{body:{action:'reset_credentials',user_id}});
 if(error){let message=error.message;try{message=(await error.context.json()).error||message}catch{}throw Error(message)}
 if(data?.error)throw Error(data.error);return data;
}
export async function removeEmployee(user_id) {
 const {data,error}=await supabase.functions.invoke('employee-admin',{body:{action:'remove_employee',user_id}});
 if(error){let message=error.message;try{message=(await error.context.json()).error||message}catch{}throw Error(message)}
 if(data?.error)throw Error(data.error);return data;
}
