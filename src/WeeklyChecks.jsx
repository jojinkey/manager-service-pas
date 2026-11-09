import React, { useState } from "react";
import { Flame, Bug, Check, TriangleAlert, Plus, X } from "lucide-react";
import { rpc } from "./api.mjs";
import { indiaDate } from "./reportingRange.mjs";

const fmtTime = (v) =>
  new Date(v).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
const FIELD_TYPES = [["pass_fail", "Pass / fail"], ["yes_no", "Yes / no"], ["text", "Text"], ["number", "Number"]];

export const smokeLine = (s) =>
  !s || s.status === "none"
    ? "No smoke test recorded yet"
    : `Last test ${s.last_test_date || s.baseline_date} · ${s.days_since} day${s.days_since === 1 ? "" : "s"} ago`;

// Compact per-outlet status for the dashboard.
export function WeeklyStatusStrip({ restaurants, smokeStatus, pestStatus, onOpenSmoke, onOpenPest }) {
  return (
    <section className="surface weekly-strip" aria-label="Weekly checks">
      <div className="panel-heading"><div><h3>Weekly checks</h3><p>Smoke test (alert after 7 days) and pest control (every week).</p></div></div>
      <div className="table-scroll"><table><thead><tr><th>Restaurant</th><th>Smoke test</th><th>Pest control</th></tr></thead><tbody>
        {restaurants.map((r) => {
          const s = smokeStatus.find((x) => x.restaurant_id === r.id), p = pestStatus.find((x) => x.restaurant_id === r.id);
          return (
            <tr key={r.id}>
              <td><strong>{r.name}</strong></td>
              <td><button className="text-button" onClick={onOpenSmoke}>
                {s?.status === "overdue" && <TriangleAlert size={13} />} {smokeLine(s)}
                {s?.status === "overdue" && <strong className="danger-text"> · OVERDUE (over 7 days)</strong>}
              </button></td>
              <td><button className="text-button" onClick={onOpenPest}>
                {p?.open_flags > 0 ? <strong className="danger-text">{p.open_flags} week{p.open_flags === 1 ? "" : "s"} missed</strong> : p?.done_this_week ? "Done this week" : p?.last_done ? `Last ${p.last_done}` : "Not recorded yet"}
              </button></td>
            </tr>
          );
        })}
      </tbody></table></div>
    </section>
  );
}

function useRun() {
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [notice, setNotice] = useState("");
  const run = async (fn, ok) => {
    setError(""); setNotice(""); setBusy(true);
    try { await fn(); if (ok) setNotice(ok); } catch (e) { setError(e.message || "Something went wrong"); } finally { setBusy(false); }
  };
  return { busy, error, notice, run };
}

const Messages = ({ error, notice }) => (
  <>
    {error && <div className="error" role="alert">{error}</div>}
    {notice && <p className="employee-success" role="status"><Check size={16} />{notice}</p>}
  </>
);

export function SmokeTestPage({ profile, admin, restaurants, scope, data, reload }) {
  const { busy, error, notice, run } = useRun();
  const today = indiaDate();
  const outlets = restaurants.filter((r) => scope === "all" || r.id === scope);
  const fields = data.smokeConfig?.fields || [];
  const canFile = !admin && data.permissions.some((p) => p.role === profile.role && p.capability === "smoke_test" && p.allowed);
  const [form, setForm] = useState({ test_date: today, values: {} });
  const [baseline, setBaseline] = useState({});
  const [draft, setDraft] = useState(null);
  const myOutlet = profile.restaurant_id;
  const tests = data.smokeTests.filter((t) => scope === "all" || t.restaurant_id === scope).sort((a, b) => b.test_date.localeCompare(a.test_date));
  const gaps = data.smokeGaps.filter((g) => scope === "all" || g.restaurant_id === scope).sort((a, b) => b.from_date.localeCompare(a.from_date));
  const name = (id) => restaurants.find((r) => r.id === id)?.name || id;
  const late = form.test_date && form.test_date < today;
  const setValue = (id, v) => setForm((f) => ({ ...f, values: { ...f.values, [id]: v } }));

  const input = (f) => {
    const v = form.values[f.id] ?? "";
    if (f.type === "pass_fail" || f.type === "yes_no") {
      const opts = f.type === "pass_fail" ? ["pass", "fail"] : ["yes", "no"];
      return <select value={v} onChange={(e) => setValue(f.id, e.target.value)}><option value="">Choose…</option>{opts.map((o) => <option key={o} value={o}>{o}</option>)}</select>;
    }
    if (f.type === "number") return <input type="number" step="any" value={v} onChange={(e) => setValue(f.id, e.target.value)} />;
    return <input value={v} maxLength={2000} onChange={(e) => setValue(f.id, e.target.value)} />;
  };

  return (
    <>
      <div className="section-toolbar"><div><h2>Smoke Test <span className="subtle">/ weekly</span></h2><p className="employee-intro">File it on the day the test was done. More than 7 days between tests raises an alert for the admin.</p></div></div>
      <Messages error={error} notice={notice} />
      <section className="surface"><div className="panel-heading"><div><h3>Status</h3></div><Flame size={20} /></div>
        <div className="table-scroll"><table><thead><tr><th>Restaurant</th><th>Status</th><th>Last test</th><th>Days since</th>{admin && <th>Baseline</th>}</tr></thead><tbody>
          {outlets.map((r) => {
            const s = data.smokeStatus.find((x) => x.restaurant_id === r.id);
            return (
              <tr key={r.id}>
                <td><strong>{r.name}</strong></td>
                <td>{!s || s.status === "none" ? "No smoke test recorded yet" : s.status === "overdue" ? <strong className="danger-text"><TriangleAlert size={13} /> Overdue — gap is over 7 days</strong> : "On track"}</td>
                <td>{s?.last_test_date || "—"}</td>
                <td>{s?.days_since ?? "—"}</td>
                {admin && <td>
                  {s?.baseline_date && <small>Start {s.baseline_date} </small>}
                  {(!s || s.status === "none" || !s.last_test_date) && (
                    <form onSubmit={(e) => { e.preventDefault(); run(async () => { await rpc("set_smoke_baseline", { p_restaurant: r.id, p_date: baseline[r.id] }); await reload(); }, "Baseline saved."); }}>
                      <input type="date" required max={today} value={baseline[r.id] || ""} onChange={(e) => setBaseline((b) => ({ ...b, [r.id]: e.target.value }))} />
                      <button className="text-button" disabled={busy}>Confirm start date</button>
                    </form>)}
                </td>}
              </tr>
            );
          })}
        </tbody></table></div>
        {admin && outlets.some((r) => !data.smokeStatus.find((x) => x.restaurant_id === r.id && x.status !== "none")) && <p className="employee-help">Until a baseline or first test exists no overdue alert is raised. Confirm the start date for each outlet.</p>}
      </section>

      {canFile && (
        <section className="surface"><div className="panel-heading"><div><h3>Record a smoke test · {name(myOutlet)}</h3><p>The test date is the day it was actually done. Future dates are not accepted.</p></div></div>
          <form onSubmit={(e) => { e.preventDefault(); run(async () => { await rpc("submit_smoke_test", { p_restaurant: myOutlet, p_test_date: form.test_date, p_data: form.values }); setForm({ test_date: today, values: {} }); await reload(); }, "Smoke test recorded."); }}>
            <div className="field-grid">
              <label>Date test was done<input type="date" required max={today} value={form.test_date} onChange={(e) => setForm((f) => ({ ...f, test_date: e.target.value }))} /></label>
              {fields.map((f) => <label key={f.id}>{f.label}{f.required ? " *" : ""}{input(f)}</label>)}
            </div>
            {late && <p className="employee-help"><TriangleAlert size={13} />This is a past date, so it will be saved as a <strong>late entry</strong>: the real test date is kept and the time you submit is logged permanently.</p>}
            <button className="button dark" disabled={busy}>{busy ? "Saving…" : "Submit smoke test"}</button>
          </form>
        </section>
      )}

      <section className="surface log-panel"><div className="panel-heading"><div><h3>Smoke test log</h3><p>Entries cannot be edited or removed.</p></div></div>
        <div className="table-scroll"><table><thead><tr><th>Test date</th><th>Restaurant</th><th>Submitted</th><th>By</th><th>Entry</th><th>Result</th></tr></thead><tbody>
          {tests.map((t) => (
            <tr key={t.id}><td>{t.test_date}</td><td>{name(t.restaurant_id)}</td><td>{fmtTime(t.submitted_at)}</td><td>{t.submitted_by_name}</td>
              <td>{t.late ? <strong className="danger-text">Late</strong> : "On the day"}</td>
              <td><small>{t.fields_snapshot.map((f) => `${f.label}: ${t.data[f.id] ?? "—"}`).join(" · ")}</small></td></tr>
          ))}
        </tbody></table>{!tests.length && <div className="empty"><p>No smoke tests recorded yet.</p></div>}</div>
      </section>

      <section className="surface log-panel"><div className="panel-heading"><div><h3>Gap history</h3><p>Every stretch longer than 7 days is kept permanently, even after a late entry.</p></div></div>
        <div className="table-scroll"><table><thead><tr><th>Restaurant</th><th>From</th><th>To</th><th>Days</th><th>State</th></tr></thead><tbody>
          {gaps.map((g) => <tr key={g.id}><td>{name(g.restaurant_id)}</td><td>{g.from_date}</td><td>{g.to_date || "—"}</td><td>{g.days ?? "—"}</td><td>{g.resolved_at ? "Closed" : <strong className="danger-text">Open alert</strong>}</td></tr>)}
        </tbody></table>{!gaps.length && <div className="empty"><p>No gaps over 7 days.</p></div>}</div>
      </section>

      {admin && (
        <>
          <section className="surface"><div className="panel-heading"><div><h3>Checklist fields</h3><p>Edit what a smoke test covers. Past entries keep the fields they were filed with.</p></div></div>
            {(() => {
              const list = draft || fields;
              const update = (i, patch) => setDraft(list.map((f, j) => (j === i ? { ...f, ...patch } : f)));
              return (
                <form onSubmit={(e) => { e.preventDefault(); run(async () => { await rpc("set_smoke_config", { p_fields: list }); setDraft(null); await reload(); }, "Checklist saved."); }}>
                  {list.map((f, i) => (
                    <div className="field-grid" key={i}>
                      <label>Label<input required maxLength={200} value={f.label} onChange={(e) => update(i, { label: e.target.value, id: f.id || e.target.value.toLowerCase().replace(/[^a-z0-9]+/g, "_").slice(0, 40) })} /></label>
                      <label>Type<select value={f.type} onChange={(e) => update(i, { type: e.target.value })}>{FIELD_TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>
                      <label>Required<input type="checkbox" checked={!!f.required} onChange={(e) => update(i, { required: e.target.checked })} /></label>
                      <button type="button" className="text-button" aria-label="Remove field" onClick={() => setDraft(list.filter((_, j) => j !== i))}><X size={14} /> Remove</button>
                    </div>
                  ))}
                  <button type="button" className="button outline small" onClick={() => setDraft([...list, { id: "", label: "", type: "pass_fail", required: false }])}><Plus size={13} />Add field</button>{" "}
                  <button className="button dark small" disabled={busy || !draft}>Save checklist</button>
                </form>
              );
            })()}
          </section>
          <RolePermissions data={data} reload={reload} />
        </>
      )}
    </>
  );
}

function RolePermissions({ data, reload }) {
  const { busy, error, notice, run } = useRun();
  const caps = [["smoke_test", "Smoke Test"], ["pest_control", "Pest Control"]];
  const roles = [["manager", "Manager"], ["chef", "Chef"], ["staff", "Staff"]];
  const allowed = (r, c) => data.permissions.some((p) => p.role === r && p.capability === c && p.allowed);
  return (
    <section className="surface"><div className="panel-heading"><div><h3>Who can fill what</h3><p>Chef and staff see only the screens ticked here, for their own outlet. Daily reports stay with managers.</p></div></div>
      <Messages error={error} notice={notice} />
      <div className="table-scroll"><table><thead><tr><th>Role</th>{caps.map(([, l]) => <th key={l}>{l}</th>)}</tr></thead><tbody>
        {roles.map(([r, l]) => <tr key={r}><td><strong>{l}</strong></td>{caps.map(([c]) => (
          <td key={c}><input type="checkbox" disabled={busy} checked={allowed(r, c)} aria-label={`${l} can fill ${c}`} onChange={(e) => run(async () => { await rpc("set_role_permission", { p_role: r, p_capability: c, p_allowed: e.target.checked }); await reload(); }, "Permission updated.")} /></td>
        ))}</tr>)}
      </tbody></table></div>
    </section>
  );
}

export function PestPage({ profile, admin, restaurants, scope, data, reload }) {
  const { busy, error, notice, run } = useRun();
  const today = indiaDate();
  const setting = data.pestSettings?.record_type || "either";
  const canFile = !admin && data.permissions.some((p) => p.role === profile.role && p.capability === "pest_control" && p.allowed);
  const [form, setForm] = useState({ done_date: today, type: setting === "treatment" ? "treatment" : "inspection", notes: "" });
  const outlets = restaurants.filter((r) => scope === "all" || r.id === scope);
  const name = (id) => restaurants.find((r) => r.id === id)?.name || id;
  const checks = data.pestChecks.filter((c) => scope === "all" || c.restaurant_id === scope).sort((a, b) => b.done_date.localeCompare(a.done_date));
  const weekOf = (d) => { const x = new Date(d + "T00:00:00Z"); x.setUTCDate(x.getUTCDate() - ((x.getUTCDay() + 6) % 7)); return x.toISOString().slice(0, 10); };
  const flags = data.pestFlags.filter((f) => scope === "all" || f.restaurant_id === scope).sort((a, b) => b.week_start.localeCompare(a.week_start));
  const covered = (f) => data.pestChecks.some((c) => c.restaurant_id === f.restaurant_id && weekOf(c.done_date) === f.week_start);
  return (
    <>
      <div className="section-toolbar"><div><h2>Pest Control <span className="subtle">/ weekly</span></h2><p className="employee-intro">A separate weekly check from the smoke test. A week (Mon–Sun) with no entry is flagged.</p></div></div>
      <Messages error={error} notice={notice} />
      <section className="surface"><div className="panel-heading"><div><h3>This week</h3></div><Bug size={20} /></div>
        <div className="table-scroll"><table><thead><tr><th>Restaurant</th><th>This week</th><th>Last done</th><th>Missed weeks (open)</th></tr></thead><tbody>
          {outlets.map((r) => { const p = data.pestStatus.find((x) => x.restaurant_id === r.id); return (
            <tr key={r.id}><td><strong>{r.name}</strong></td><td>{p?.done_this_week ? "Done" : "Not yet"}</td><td>{p?.last_done || "—"}</td><td>{p?.open_flags ? <strong className="danger-text">{p.open_flags}</strong> : 0}</td></tr>); })}
        </tbody></table></div>
      </section>
      {canFile && (
        <section className="surface"><div className="panel-heading"><div><h3>Record pest control · {name(profile.restaurant_id)}</h3></div></div>
          <form onSubmit={(e) => { e.preventDefault(); run(async () => { await rpc("submit_pest_check", { p_restaurant: profile.restaurant_id, p_done_date: form.done_date, p_type: form.type, p_data: { notes: form.notes } }); setForm((f) => ({ ...f, notes: "" })); await reload(); }, "Pest control recorded."); }}>
            <div className="field-grid">
              <label>Date done<input type="date" required max={today} value={form.done_date} onChange={(e) => setForm((f) => ({ ...f, done_date: e.target.value }))} /></label>
              <label>Record type<select value={form.type} disabled={setting !== "either"} onChange={(e) => setForm((f) => ({ ...f, type: e.target.value }))}><option value="inspection">Inspection</option><option value="treatment">Treatment</option></select></label>
              <label>Notes<input value={form.notes} maxLength={2000} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} /></label>
            </div>
            <button className="button dark" disabled={busy}>{busy ? "Saving…" : "Submit"}</button>
          </form>
        </section>
      )}
      <section className="surface log-panel"><div className="panel-heading"><div><h3>Flagged weeks</h3><p>Flags are kept even after a late entry covers the week.</p></div></div>
        <div className="table-scroll"><table><thead><tr><th>Restaurant</th><th>Week starting</th><th>State</th></tr></thead><tbody>
          {flags.map((f) => <tr key={f.restaurant_id + f.week_start}><td>{name(f.restaurant_id)}</td><td>{f.week_start}</td><td>{covered(f) ? "Recorded late" : <strong className="danger-text">Missed</strong>}</td></tr>)}
        </tbody></table>{!flags.length && <div className="empty"><p>No missed weeks.</p></div>}</div>
      </section>
      <section className="surface log-panel"><div className="panel-heading"><div><h3>Pest control log</h3></div></div>
        <div className="table-scroll"><table><thead><tr><th>Date</th><th>Restaurant</th><th>Type</th><th>Submitted</th><th>By</th><th>Notes</th></tr></thead><tbody>
          {checks.map((c) => <tr key={c.id}><td>{c.done_date}</td><td>{name(c.restaurant_id)}</td><td>{c.record_type}</td><td>{fmtTime(c.submitted_at)}</td><td>{c.submitted_by_name}</td><td><small>{c.data?.notes}</small></td></tr>)}
        </tbody></table>{!checks.length && <div className="empty"><p>No pest control recorded yet.</p></div>}</div>
      </section>
      {admin && (
        <section className="surface"><div className="panel-heading"><div><h3>What is recorded</h3><p>Inspection, treatment, or either. Change this once the owner decides.</p></div></div>
          <select value={setting} disabled={busy} onChange={(e) => run(async () => { await rpc("set_pest_settings", { p_record_type: e.target.value }); await reload(); }, "Saved.")}>
            <option value="either">Inspection or treatment</option><option value="inspection">Inspection only</option><option value="treatment">Treatment only</option>
          </select>
        </section>
      )}
    </>
  );
}
