import React,{useState,useEffect} from 'react';
export default function ScoringSettings({restaurant,settings,cycle,onSave,onReset}) {
 const initial=()=>({days:settings?.reset_every_days??'',benchmark:settings?.minimum_benchmark??''});
 const [form,setForm]=useState(initial),[dirty,setDirty]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(''),[confirm,setConfirm]=useState(false);
 useEffect(()=>{if(!dirty)setForm(initial())},[settings,dirty]);
 const change=(key,value)=>{setDirty(true);setForm(p=>({...p,[key]:value}))};
 const action=async(fn)=>{setBusy(true);setError('');try{await fn()}catch(e){setError(e.message)}finally{setBusy(false)}};
 return <section className="surface scoring-settings">
  <div className="panel-heading"><div><h3>Points cycle · {restaurant?.name}</h3><p>Everyone starts each cycle at 200 (maximum 200). Points reset after your chosen number of days.</p></div></div>
  <form onSubmit={e=>{e.preventDefault();action(async()=>{await onSave({days:Number(form.days),benchmark:form.benchmark===''?null:Number(form.benchmark)});setDirty(false)})}}>
   <div className="field-grid"><label>Reset points every (days)<input type="number" min="1" step="1" required value={form.days} onChange={e=>change('days',e.target.value)} placeholder="For example, 15 or 30"/></label>
   <label>Minimum score benchmark<input type="number" min="0" step="1" value={form.benchmark} onChange={e=>change('benchmark',e.target.value)} placeholder="Optional alert threshold"/></label></div>
   <p className="policy-help">Every cycle starts at 200: +5 per on-time report, −20 per missed report. Report and points history stays available after every reset. Saving an interval does not start or reset a cycle; an interval change applies at the next reset.</p>
   <p className="policy-help">Admins receive a dashboard alert when a manager is below the benchmark. Only that manager receives their own advance warning when one more missed-form deduction would take them below it.</p>
   <button className="button dark small" disabled={busy}>{busy?'Saving…':'Save points settings'}</button>
  </form>
  <div className="window-banner"><span>{cycle?<>Current cycle started {new Date(cycle.starts_at).toLocaleString('en-IN',{timeZone:'Asia/Kolkata'})}. Scheduled reset: {new Date(cycle.ends_at).toLocaleString('en-IN',{timeZone:'Asia/Kolkata'})} (India time).</>:'Points cycle not started. Save the interval, then start manually before activating reports.'}</span></div>
  {confirm?<div className="reset-confirm"><p>Set all managers at {restaurant?.name} back to 200 points now? Report and points history will be kept. The next interval starts now.</p><button className="button dark small" disabled={busy} onClick={()=>action(async()=>{await onReset();setConfirm(false)})}>Confirm reset to 200</button><button className="button outline small" onClick={()=>setConfirm(false)} disabled={busy}>Cancel</button></div>:<button type="button" className="button outline small" disabled={busy||!settings||dirty} onClick={()=>setConfirm(true)}>{cycle?'Reset now':'Start points cycle'}</button>}
  {error&&<p className="error" role="alert">{error}</p>}
 </section>;
}
