import React, { useState } from 'react';
const ist = { timeZone: 'Asia/Kolkata' };
const when = (d) => new Date(d).toLocaleString('en-IN', { ...ist, day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', hour12: true });
const labels = { opening: 'Opening', closing: 'Closing', incident: 'Incident', briefing: 'Briefing' };
// Admin-only: give ONE report a later deadline for that day only. The standing schedule is not changed.
export default function DeadlineExtensions({ occurrences = [], restaurants = [], onExtend }) {
  const now = Date.now();
  const rows = occurrences
    .filter((o) => !o.submitted_at && !o.missed_at && +new Date(o.deadline) > now && +new Date(o.opens_at) < now + 36 * 3600e3)
    .sort((a, b) => +new Date(a.deadline) - +new Date(b.deadline));
  const [times, setTimes] = useState({}), [busy, setBusy] = useState(''), [error, setError] = useState(''), [notice, setNotice] = useState('');
  const go = async (o) => {
    setBusy(o.id); setError(''); setNotice('');
    try { await onExtend(o.id, times[o.id]); setNotice('Deadline updated for that day only.'); setTimes((t) => ({ ...t, [o.id]: '' })); }
    catch (e) { setError(e.message); } finally { setBusy(''); }
  };
  return <section className="surface pad-panel">
    <div className="panel-heading"><div><h3>Extend a deadline for today only</h3>
      <p>Pick a new closing time for one report. It applies immediately and only to that day. The standing schedule does not change. A time that has already passed cannot be set.</p></div></div>
    {error && <p className="error" role="alert">{error}</p>}{notice && <p className="employee-help" role="status">{notice}</p>}
    {rows.length ? <div className="table-scroll"><table><thead><tr><th>Outlet</th><th>Report</th><th>Day</th><th>Current deadline</th><th>New deadline (IST)</th><th></th></tr></thead><tbody>
      {rows.map((o) => <tr key={o.id}>
        <td>{restaurants.find((r) => r.id === o.restaurant_id)?.name || o.restaurant_id}</td>
        <td>{labels[o.type] || o.type}</td><td>{o.business_date}</td><td>{when(o.deadline)}</td>
        <td><input type="time" value={times[o.id] || ''} onChange={(e) => setTimes((t) => ({ ...t, [o.id]: e.target.value }))} /></td>
        <td><button className="button dark small" disabled={!times[o.id] || busy === o.id} onClick={() => go(o)}>{busy === o.id ? 'Saving…' : 'Extend'}</button></td>
      </tr>)}</tbody></table></div> : <p className="employee-help">No open reports right now.</p>}
  </section>;
}
