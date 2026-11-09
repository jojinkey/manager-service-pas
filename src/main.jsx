import Evidence from "./Evidence.jsx";
import PasswordSettings from "./PasswordSettings.jsx";
import Login from "./Login.jsx";
import Trend from "./Trend.jsx";
import React, { useState, useEffect } from "react";
import { createRoot } from "react-dom/client";
import {
  LayoutDashboard,
  ClipboardList,
  ChartNoAxesCombined,
  Settings,
  LogOut,
  Bell,
  Search,
  ChevronDown,
  ArrowUpRight,
  ArrowRight,
  Download,
  Plus,
  Clock,
  Check,
  CheckCheck,
  Lock,
  Sun,
  Moon,
  TriangleAlert,
  MessageSquare,
  CalendarDays,
  SlidersHorizontal,
  X,
  Flag,
  Flame,
  Bug,
  UtensilsCrossed,
  Building2,
  ShieldCheck,
  ChevronRight,
  Users,
  Eye,
  FileText,
  Info,
} from "lucide-react";
import { supabase, signIn, signInPhone, issuePhoneSetup, resetCredentials, readTable, rpc, createEmployee } from "./api.mjs";
import Employees from "./Employees.jsx";
import { SmokeTestPage, PestPage, WeeklyStatusStrip } from "./WeeklyChecks.jsx";
import {
  stateOf,
  resolveWindow,
  validateResponses,
} from "./policy.mjs";
import { kinds, labels, briefing } from "./constants.mjs";
import templates from "./templates.json";
import { refreshPolicyDraft } from "./policyDraft.mjs";
import { indiaDate, historyStart, validateRange, inDateRange, summarizeRange } from "./reportingRange.mjs";
import ScoringSettings from "./ScoringSettings.jsx";
import "./style.css";
const IconFor = {
  opening: Sun,
  closing: Moon,
  incident: TriangleAlert,
  briefing: MessageSquare,
};
const fmt = (
  v,
  options = {
    hour: "2-digit",
    minute: "2-digit",
  },
) =>
  new Date(v).toLocaleString("en-IN", {
    timeZone: "Asia/Kolkata",
    ...options,
  });
function Badge({ status }) {
  return (
    <span className={"badge " + status.toLowerCase().replaceAll(" ", "-")}>
      {status === "Submitted" ? (
        <Check size={11} />
      ) : status === "Open" ? (
        <span className="dot" />
      ) : status === "Missed" ? (
        <Lock size={10} />
      ) : null}
      {status}
    </span>
  );
}
function App() {
  const [profile, setProfile] = useState(null);
  const [restaurants, setRestaurants] = useState([]),
    [policies, setPolicies] = useState([]),
    [reports, setReports] = useState([]),
    [occurrences, setOccurrences] = useState([]),
    [ledger, setLedger] = useState([]),
    [users, setUsers] = useState([]),
    [highlights, setHighlights] = useState([]);
  const [scoreSettings,setScoreSettings]=useState([]),[scoreCycles,setScoreCycles]=useState([]),[scoreTotals,setScoreTotals]=useState([]);
  const [scoreAlerts,setScoreAlerts]=useState([]);
  const [weekly,setWeekly]=useState({smokeTests:[],smokeGaps:[],smokeStatus:[],smokeConfig:null,permissions:[],pestChecks:[],pestFlags:[],pestStatus:[],pestSettings:null});
  const [page, setPage] = useState("overview"),
    [restaurantId, setRestaurantId] = useState("all"),
    [reportType, setReportType] = useState("opening"),
    [activeReport, setActiveReport] = useState(null),
    [toast, setToast] = useState(""),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(false),
    [lastSynced, setLastSynced] = useState(null),
    [showNotifications, setShowNotifications] = useState(false),
    [query, setQuery] = useState(""),
    [dateRange, setDateRange] = useState(() => ({from:indiaDate(),to:indiaDate()})),
    [filter, setFilter] = useState("all");
  const [tick, setTick] = useState(Date.now());
  useEffect(() => {
    const timer = setInterval(() => setTick(Date.now()), 30000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    if (profile && !["admin","manager"].includes(profile.role)) setPage((p) => (p === "smoke" || p === "pest" || p === "account" ? p : "smoke"));
  }, [profile]);
  const now = new Date(tick),
    date = fmt(now, {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    })
      .split("/")
      .reverse()
      .join("-");
  const limited = !!profile && !["admin","manager"].includes(profile.role),
    admin = profile?.role === "admin",
    scope = admin ? restaurantId : profile?.restaurant_id,
    visibleRestaurants = restaurants.filter(
      (r) => scope === "all" || r.id === scope,
    ),
    visibleReports = reports.filter(
      (r) => scope === "all" || r.restaurant_id === scope,
    );
  const notify = (msg) => {
    setToast(msg);
    setTimeout(() => setToast(""), 4500);
  };
  async function load() {
    if (!supabase) return;
    setLoading(true);
    setError("");
    try {
      const [rs, ps, re, oc, ls, hs, us, ss, sc, st, sa, smT, smG, smS, smC, perm, peC, peF, peS, peSet] = await Promise.all(
        [
          "restaurants",
          "policies",
          "reports",
          "occurrences",
          "score_ledger",
          "highlights",
          "profiles",
          "score_settings", "score_cycles", "current_score_totals",
          "score_alerts",
          "smoke_tests","smoke_gaps","smoke_status","smoke_config","role_permissions","pest_checks","pest_flags","pest_status","pest_settings",
        ].map(readTable),
      );
      if (us.find(u=>u.id===profile?.id)?.active===false) {
        setProfile(null);
        await supabase.auth.signOut({scope:'local'});
        return false;
      }
      setRestaurants(
        rs.map((r) => ({
          ...r,
          manager: us
            .filter((u) => u.restaurant_id === r.id)
            .map((u) => u.name)
            .join(", "),
        })),
      );
      setScoreSettings(ss);setScoreCycles(sc);setScoreTotals(st);
      setScoreAlerts(sa.filter(a=>a.active));
      setWeekly({smokeTests:smT,smokeGaps:smG,smokeStatus:smS,smokeConfig:smC[0]||null,permissions:perm,pestChecks:peC,pestFlags:peF,pestStatus:peS,pestSettings:peSet[0]||null});
      setUsers(us);
      setPolicies(ps);
      setReports(
        re.sort((a, b) => b.submitted_at.localeCompare(a.submitted_at)),
      );
      setOccurrences(oc);
      setLedger(ls);
      setHighlights(
        hs.sort((a, b) => b.created_at.localeCompare(a.created_at)),
      );
      setLastSynced(new Date());
      return true;
    } catch (e) {
      setError(e.message);
      return false;
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    if (profile) load();
  }, [profile, tick]);
  useEffect(() => {
    if (!supabase) return;
    supabase.auth.getSession().then(async ({ data }) => {
      if (data.session) {
        const { data: p } = await supabase
          .from("profiles")
          .select("*")
          .eq("id", data.session.user.id)
          .single();
        if (p?.active) {
          setProfile(p);
          setRestaurantId(p.restaurant_id || "all");
        }
      }
    });
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_OUT") setProfile(null);
    });
    return () => subscription.unsubscribe();
  }, []);
  useEffect(() => {
    if (!supabase || !profile) return;
    let timer;
    const refresh = () => {
      clearTimeout(timer);
      timer = setTimeout(() => load(), 120);
    };
    let channel = supabase.channel("operations-" + profile.id);
    for (const table of [
      "reports",
      "score_ledger",
      "occurrences",
      "highlights",
      "score_alerts",
    ])
      channel = channel.on(
        "postgres_changes",
        { event: "*", schema: "public", table },
        refresh,
      );
    channel.subscribe();
    return () => {
      clearTimeout(timer);
      supabase.removeChannel(channel);
    };
  }, [profile?.id]);
  const currentPoints = (rid, managerId) => scoreTotals.filter(s=>s.restaurant_id===rid&&(!managerId||s.manager_id===managerId)).reduce((n,s)=>n+s.points,0);
  const getPolicy = (r, t) =>
    policies.find(
      (p) => p.restaurant_id === r && p.type === t && p.current !== false,
    );
  const getOccurrence = (r, t) => {
    const scoped = occurrences.filter(
      (o) => o.restaurant_id === r && o.type === t,
    );
    return (
      scoped.find(
        (o) => +new Date(o.opens_at) <= +now && +now < +new Date(o.deadline),
      ) || scoped.find((o) => o.business_date === date)
    );
  };
  const status = (r, t) => stateOf(getOccurrence(r, t), now);
  const rangeReports = visibleReports.filter(r=>inDateRange(r,dateRange.from,dateRange.to));
  const rangeLedger = ledger.filter(l=>(scope==='all'||l.restaurant_id===scope)&&inDateRange(l,dateRange.from,dateRange.to));
  const rangeSummary = summarizeRange({
    reports:visibleReports,ledger:rangeLedger,
    occurrences:occurrences.filter(o=>scope==='all'||o.restaurant_id===scope),
    users:users.filter(u=>scope==='all'||u.restaurant_id===scope),
    ...dateRange,now,
  });
  const done = rangeSummary.submitted, scheduledCount=rangeSummary.scheduled,
    missed=rangeSummary.missed, open=rangeSummary.awaited;
  const rangeLabel=dateRange.from===dateRange.to?dateRange.from:`${dateRange.from} – ${dateRange.to}`;
  function openForm(type, rid) {
    setRestaurantId(
      rid || (scope === "all" || !scope ? restaurants[0]?.id : scope),
    );
    setReportType(type);
    setActiveReport(null);
    setPage("form");
  }
  function sourceReport(report) {
    setRestaurantId(report.restaurant_id);
    setReportType(report.type);
    setActiveReport(report);
    setPage("form");
  }
  async function submit(data) {
    const rid = scope === "all" ? restaurants[0].id : scope,
      o = getOccurrence(rid, reportType);
    if (stateOf(o, now) !== "Open")
      throw Error(
        "This report is locked. Submission is only available inside the allowed window.",
      );
    const dataResult = await rpc("submit_report", {
      p_occurrence: o.id,
      p_data: data,
    });
    await load();
    return dataResult;
  }
  async function saveDraft(data, quiet = false) {
    const o = getOccurrence(scope, reportType);
    await rpc("save_draft", {
      p_occurrence: o.id,
      p_data: data,
    });
    if (!quiet) notify("Draft saved • not submitted");
  }
  function download() {
    const csv = [
      [
        "Restaurant",
        "Manager",
        "Report",
        "Business date",
        "Shift",
        "Submitted at (UTC)",
      ],
      ...rangeReports
        .filter(matches)
        .map((r) => [
          restaurants.find((x) => x.id === r.restaurant_id)?.name,
          r.manager_name,
          labels[r.type],
          r.business_date,
          r.shift,
          r.submitted_at,
        ]),
    ]
      .map((row) =>
        row
          .map(
            (v) =>
              '"' +
              String(v ?? "")
                .replaceAll('"', '""')
                .replace(/^[=+@-]/, "'$&") +
              '"',
          )
          .join(","),
      )
      .join("\r\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(
      new Blob([csv], {
        type: "text/csv",
      }),
    );
    a.download = `service-reports-${date}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
    notify("Report log exported");
  }
  function matches(r) {
    const text = [
      r.manager_name,
      restaurants.find((x) => x.id === r.restaurant_id)?.name,
      labels[r.type],
      r.business_date,
    ]
      .join(" ")
      .toLowerCase();
    return (
      text.includes(query.toLowerCase()) &&
      (filter === "all" || r.type === filter)
    );
  }
  async function logout() {
    await supabase.auth.signOut();
    setProfile(null);
    setPage("overview");
  }
  const nav = (target) => {
    setPage(target);
    setActiveReport(null);
  };
  if (!profile)
    return (
      <Login
        onLogin={async (e, p, mode, activationCode) => {
          const user = mode==='admin'?await signIn(e,p):await signInPhone(e,p,activationCode);
          setProfile(user);
          setRestaurantId(user.restaurant_id || "all");
        }}
      />
    );
  const selectedRestaurant =
    restaurants.find((r) => r.id === scope) || visibleRestaurants[0];
  const selectedOccurrence = activeReport
    ? occurrences.find((o) => o.id === activeReport.occurrence_id)
    : getOccurrence(selectedRestaurant?.id, reportType);
  const selectedSubmission =
    activeReport ||
    reports.find((r) => r.occurrence_id === selectedOccurrence?.id);
  return (
    <div className="app-shell">
      <header className="topbar glass">
        <a
          className="wordmark"
          href="#"
          onClick={(e) => {
            e.preventDefault();
            nav("overview");
          }}
        >
          <span className="brand-symbol">
            <UtensilsCrossed size={19} />
          </span>
          service<span className="wordmark-period">.</span>
        </a>
        <div className="top-center">
          <span className="tiny-dot" />A little structure. A better service.
        </div>
        <div className="top-right">
          <span className="live-label">
            {error
              ? "Connection needs attention"
              : lastSynced
                ? "Connected workspace"
                : "Connecting…"}
          </span>
          <button
            className="icon-button notification-button"
            aria-label="Notifications"
            onClick={() => setShowNotifications(!showNotifications)}
          >
            <Bell size={18} />
            {!!scoreAlerts.length && <span />}
          </button>
          <button
            className="avatar"
            title={profile.name}
            onClick={() => nav("account")}
          >
            {profile.name
              ?.split(" ")
              .map((n) => n[0])
              .join("")
              .slice(0, 2)}
          </button>
        </div>
      </header>
      <div className="workspace">
        <aside className="sidebar glass">
          <div className="side-main">
            {(limited ? [] : [
              [LayoutDashboard, "overview", "Overview"],
              [ClipboardList, "reports", "Reports"],
              [ChartNoAxesCombined, "performance", "Performance"],
              ...(admin ? [[Users, "employees", "Employees"]] : []),
              ...(admin ? [[Settings, "settings", "Settings"]] : []),
            ]).map(([Icon, key, label]) => (
              <button
                key={key}
                className={
                  "rail-button " +
                  (page === key || (page === "form" && key === "reports")
                    ? "active"
                    : "")
                }
                aria-label={label}
                title={label}
                onClick={() => nav(key)}
              >
                <Icon size={19} />
                <span className="rail-tooltip">{label}</span>
              </button>
            ))}
          </div>
          <div className="side-bottom">
            <span className="rail-divider" />
            <button
              className="rail-button"
              title="Account"
              aria-label="Account"
              onClick={() => nav("account")}
            >
              <ShieldCheck size={19} />
            </button>
            <button
              className="rail-button"
              aria-label="Sign out"
              title="Sign out"
              onClick={logout}
            >
              <LogOut size={18} />
            </button>
          </div>
        </aside>
        <main className="main-panel glass">
          <div className="page-heading">
            <div>
              <div className="breadcrumb">
                Workspace <ChevronRight size={12} />{" "}
                {admin ? "Administration" : selectedRestaurant?.name}
              </div>
              <h1>
                {page === "overview"
                  ? "Every detail. Every service."
                  : page === "reports"
                    ? "Your daily reports."
                    : page === "performance"
                      ? "Consistency, recognised."
                      : page === "employees"
                        ? "Great service starts with people."
                        : page === "settings"
                          ? "Make time for standards."
                          : page === "account"
                            ? "Your workspace."
                            : labels[reportType]}
              </h1>
              <p>
                {page === "overview"
                  ? `${Number(fmt(now, { hour: "numeric", hour12: false })) < 12 ? "Good morning" : Number(fmt(now, { hour: "numeric", hour12: false })) < 17 ? "Good afternoon" : "Good evening"}, ${profile.name}. Here’s how your restaurants are doing.`
                  : page === "reports"
                    ? "The right checks, at the right time. All in one place."
                    : page === "settings"
                      ? "Set reporting windows and keep expectations clear."
                      : page === "employees"
                        ? "Create individual logins and assign each manager to their restaurant."
                        : page === "performance"
                          ? "Reporting accountability for any date or range."
                          : page === "form"
                            ? "Complete each detail and submit within your reporting window."
                            : "Your access, restaurant and connection details."}
              </p>
            </div>
            <div className="heading-actions">
              <span className="date-chip">
                <CalendarDays size={14} />
                {fmt(now, {
                  day: "numeric",
                  month: "short",
                  year: "numeric",
                })}
              </span>
              {admin && (
                <label className="restaurant-select">
                  <Building2 size={14} />
                  <select
                    aria-label="Filter restaurant"
                    value={restaurantId}
                    onChange={(e) => {
                      setRestaurantId(e.target.value);
                      setActiveReport(null);
                    }}
                  >
                    <option value="all">All restaurants</option>
                    {restaurants.map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.name}
                      </option>
                    ))}
                  </select>
                  <ChevronDown size={12} />
                </label>
              )}
            </div>
          </div>

          {error && (
            <div className="error" role="alert">
              {error}
              <button onClick={load}>Retry</button>
            </div>
          )}
          {loading && (
            <div className="loading-bar" aria-label="Loading workspace" />
          )}
          {!!scoreAlerts.length && <ScoreAlertList alerts={scoreAlerts} users={users} restaurants={restaurants} admin={admin} />}
          <nav className="report-tabs" aria-label="Report types">
            {!limited && kinds.map((t) => {
              const I = IconFor[t];
              return (
                <button
                  key={t}
                  className={
                    page === "form" && reportType === t ? "selected" : ""
                  }
                  onClick={() => openForm(t)}
                >
                  <I size={15} />
                  {labels[t]}
                  <span className="tab-time">
                    {t === "opening" ? "AM" : "PM"}
                  </span>
                </button>
              );
            })}
            <button className={page === "smoke" ? "selected" : ""} onClick={() => nav("smoke")}>
              <Flame size={15} />
              Smoke Test
              <span className="tab-time">WK</span>
            </button>
            <button className={page === "pest" ? "selected" : ""} onClick={() => nav("pest")}>
              <Bug size={15} />
              Pest Control
              <span className="tab-time">WK</span>
            </button>
          </nav>
          {page === "overview" && !limited && (
            <>
              <WeeklyStatusStrip restaurants={visibleRestaurants} smokeStatus={weekly.smokeStatus} pestStatus={weekly.pestStatus} onOpenSmoke={() => nav("smoke")} onOpenPest={() => nav("pest")} />
              <div className="section-toolbar">
                <div>
                  <h2>
                    Operations overview{" "}
                    <span className="subtle">
                      / {visibleRestaurants.length}{" "}
                      {visibleRestaurants.length === 1
                        ? "restaurant"
                        : "restaurants"}
                    </span>
                  </h2>
                </div>
                <div className="toolbar-right">
                  <button
                    className="button outline small"
                    aria-label="Refresh dashboard"
                    disabled={loading}
                    onClick={load}
                  >
                    <CheckCheck size={13} />
                    Refresh
                  </button>
                  <button className="button dark small" onClick={download}>
                    <Download size={13} />
                    Export CSV
                  </button>
                </div>
              </div>
              <DateRangePicker key={rangeLabel} value={dateRange} today={date} onChange={setDateRange} />
              {highlights
                .filter((h) => (scope === "all" || h.restaurant_id === scope) && inDateRange({business_date:indiaDate(new Date(h.created_at))},dateRange.from,dateRange.to))
                .map((h) => (
                  <div className="highlight-strip" key={h.id}>
                    <span className="highlight-icon">
                      <Flag size={15} />
                    </span>
                    <div>
                      <strong>Director highlight</strong>
                      <span>{h.text}</span>
                      <small>
                        {
                          restaurants.find((r) => r.id === h.restaurant_id)
                            ?.name
                        }{" "}
                        · {h.manager_name} · {labels[h.type]}
                        {h.row_number != null
                          ? ` · Item ${h.row_number + 1}`
                          : ""}{" "}
                        ·{" "}
                        {fmt(h.created_at, {
                          day: "numeric",
                          month: "short",
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </small>
                    </div>
                    <button
                      className="text-button"
                      onClick={() => {
                        const r = reports.find((r) => r.id === h.report_id);
                        if (r) sourceReport(r);
                        else
                          notify(
                            "Source report is unavailable to this account",
                          );
                      }}
                    >
                      View report <ArrowUpRight size={15} />
                    </button>
                  </div>
                ))}
              <div className="stats-grid">
                <Stat
                  icon={Building2}
                  title="Restaurants"
                  value={String(visibleRestaurants.length).padStart(2, "0")}
                  meta="One standard. Every outlet."
                />
                <Stat
                  icon={CheckCheck}
                  title="Reports submitted"
                  value={String(done).padStart(2, "0")}
                  meta={`${scheduledCount} scheduled reports`}
                  status="positive"
                />
                <Stat
                  icon={Clock}
                  title="Awaiting reports"
                  value={String(open).padStart(2, "0")}
                  meta="Not submitted yet, including upcoming windows"
                  status="amber"
                />
                <Stat
                  icon={TriangleAlert}
                  title="Reports missed"
                  value={String(missed).padStart(2, "0")}
                  meta={"Deduction follows the report's saved rule"}
                  status="negative"
                />
              </div>
              <div className="charts-grid">
                <section className="surface trend-panel">
                  <div className="panel-heading">
                    <div>
                      <h3>Reporting rhythm</h3>
                      <p>
                        Submission activity · {rangeLabel}
                      </p>
                    </div>
                    <div className="legend">
                      <span>
                        <i />
                        On time
                      </span>
                    </div>
                  </div>
                  <Trend range={dateRange} reports={rangeReports} />
                </section>
                <section className="surface compliance-panel">
                  <div className="panel-heading">
                    <div>
                      <h3>Selected dates’ completion</h3>
                      <p>A small check. A stronger service.</p>
                    </div>
                    <ArrowUpRight size={16} />
                  </div>
                  <div className="ring-wrap">
                    <svg className="ring" viewBox="0 0 140 140">
                      <circle cx="70" cy="70" r="53" className="ring-bg" />
                      <circle
                        cx="70"
                        cy="70"
                        r="53"
                        className="ring-value"
                        strokeDasharray={`${scheduledCount ? (done / scheduledCount) * 333 : 0} 333`}
                      />
                    </svg>
                    <div className="ring-center">
                      <strong>
                        {scheduledCount
                          ? Math.round((done / scheduledCount) * 100)
                          : 0}
                        <span>%</span>
                      </strong>
                      <small>reports completed</small>
                    </div>
                  </div>
                  <div className="completion-key">
                    <span>
                      <i className="filled-dot" />
                      Submitted <b>{done}</b>
                    </span>
                    <span>
                      <i className="empty-dot" />
                      Remaining <b>{scheduledCount - done}</b>
                    </span>
                  </div>
                </section>
              </div>
              <section className="surface restaurant-panel">
                <div className="panel-heading">
                  <div>
                    <h3>On the floor</h3>
                    <p>Reporting for {rangeLabel}, restaurant by restaurant.</p>
                  </div>
                  <button
                    className="text-button"
                    onClick={() => nav("reports")}
                  >
                    All reports <ArrowRight size={14} />
                  </button>
                </div>
                <div className="table-scroll">
                  <table>
                    <thead>
                      <tr>
                        <th>Restaurant</th>
                        <th>Manager on duty</th>
                        {kinds.map((t) => (
                          <th key={t}>
                            {t.charAt(0).toUpperCase() + t.slice(1)}
                          </th>
                        ))}
                        <th>Points earned in range</th>
                        <th />
                      </tr>
                    </thead>
                    <tbody>
                      {visibleRestaurants.map((r, i) => (
                        <tr key={r.id}>
                          <td>
                            <div className="restaurant-cell">
                              <span
                                className="restaurant-monogram"
                                style={{
                                  "--outlet": r.color || "#8c7464",
                                }}
                              >
                                {r.short ||
                                  r.name
                                    .split(" ")
                                    .map((n) => n[0])
                                    .slice(0, 2)
                                    .join("")}
                              </span>
                              <div>
                                <strong>{r.name}</strong>
                                <small>{r.location}</small>
                              </div>
                            </div>
                          </td>
                          <td>{r.manager || "Assignment pending"}</td>
                          {kinds.map((t) => (
                            <td key={t}>
                              <button
                                className="status-button"
                                aria-label={`${r.name} ${labels[t]}`}
                                onClick={() => openForm(t, r.id)}
                              >
                                <RangeReportStatus reports={rangeReports.filter(x=>x.restaurant_id===r.id&&x.type===t)} occurrences={occurrences.filter(o=>o.restaurant_id===r.id&&o.type===t)} range={dateRange} now={now} />
                              </button>
                            </td>
                          ))}
                          <td>
                            <strong className="points-number">
                              {rangeSummary.managers.filter(m=>m.restaurant_id===r.id).reduce((n,m)=>n+m.earned,0)}
                            </strong>
                            <span className="points-suffix"> pts</span>
                          </td>
                          <td>
                            <button
                              className="icon-button"
                              aria-label={`Open ${r.name}`}
                              onClick={() => openForm("opening", r.id)}
                            >
                              <ArrowUpRight size={16} />
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
              {admin && <ManagerRangeSummary managers={rangeSummary.managers} restaurants={restaurants} rangeLabel={rangeLabel} />}
            </>
          )}
          {page === "reports" && (
            <>
              <div className="section-toolbar">
                <h2>Report register</h2>
                <button className="button dark small" onClick={download}>
                  <Download size={13} />
                  Export CSV
                </button>
              </div>
              <DateRangePicker key={rangeLabel} value={dateRange} today={date} onChange={setDateRange} />
              <div className="report-cards">
                {kinds.map((t) => {
                  const I = IconFor[t],
                    rid = scope === "all" ? restaurants[0].id : scope,
                    p = getPolicy(rid, t);
                  return (
                    <button
                      className="surface report-card"
                      key={t}
                      onClick={() => openForm(t, rid)}
                    >
                      <div>
                        <I size={22} />
                        <Badge status={status(rid, t)} />
                      </div>
                      <h3>{labels[t]}</h3>
                      <p>
                        {p
                          ? `${p.start_time} – ${p.end_time} · ${t === "opening" ? "Morning" : "Evening"}`
                          : "Policy not configured"}
                      </p>
                      <span>
                        {t === "opening"
                          ? "Start service with confidence"
                          : t === "closing"
                            ? "Leave the next shift ready"
                            : t === "incident"
                              ? "Keep the facts and follow-up clear"
                              : "Bring the team onto the same page"}{" "}
                        <ArrowRight size={15} />
                      </span>
                    </button>
                  );
                })}
              </div>
              <section className="surface log-panel">
                <div className="panel-heading">
                  <div>
                    <h3>Submission log</h3>
                    <p>Who submitted, what changed, and when.</p>
                  </div>
                </div>
                <div className="log-filters">
                  <label className="search-field">
                    <Search size={16} />
                    <input
                      aria-label="Search report log"
                      placeholder="Search restaurant, manager or date…"
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                    />
                  </label>
                  <select
                    aria-label="Filter report type"
                    value={filter}
                    onChange={(e) => setFilter(e.target.value)}
                  >
                    <option value="all">All report types</option>
                    {kinds.map((t) => (
                      <option value={t} key={t}>
                        {labels[t]}
                      </option>
                    ))}
                  </select>
                </div>
                <ReportTable
                  reports={rangeReports.filter(matches)}
                  restaurants={restaurants}
                  onOpen={sourceReport}
                />
              </section>
            </>
          )}
          {page === "performance" && (
            <>
            <DateRangePicker key={rangeLabel} value={dateRange} today={date} onChange={setDateRange} />
            <ManagerRangeSummary managers={rangeSummary.managers} restaurants={restaurants} rangeLabel={rangeLabel} />
            <Performance
              restaurants={visibleRestaurants}
              ledger={rangeLedger}
              reports={rangeReports}
              rangeLabel={rangeLabel}
              now={now}
              currentPoints={currentPoints}
              users={users.filter(
                (u) => scope === "all" || u.restaurant_id === scope,
              )}
            />
            </>
          )}
          {page === "settings" && admin && (
            <SettingsPage
              scoreSettings={scoreSettings} scoreCycles={scoreCycles}
              onSaveScoring={async(rid,values)=>{await rpc('configure_scoring',{p_restaurant:rid,p_days:values.days,p_benchmark:values.benchmark});await load();notify('Points settings saved')}}
              onResetPoints={async rid=>{await rpc('reset_points',{p_restaurant:rid});await load();notify('Points cycle started at 0; history kept')}}
              policies={policies}
              restaurants={restaurants}
              users={users}
              onSave={async (p) => {
                await rpc("configure_policy", {
                  p_policy: p,
                });
                await load();
                notify("Future reporting policy updated");
              }}
            />
          )}
          {page === "smoke" && <SmokeTestPage profile={profile} admin={admin} restaurants={restaurants} scope={scope} data={weekly} reload={load} />}
          {page === "pest" && <PestPage profile={profile} admin={admin} restaurants={restaurants} scope={scope} data={weekly} reload={load} />}
          {page === "employees" && admin && (
            <Employees
              currentUserId={profile.id}
              onSetup={async(id,phone)=>{const result=await issuePhoneSetup(id,phone);await load();return result}}
              ledger={ledger}
              onAdjust={async(id,amount,note)=>{const applied=await rpc('adjust_points',{p_user:id,p_amount:amount,p_note:note});await load();return applied}}
              onReassign={async(id,restaurant)=>{await rpc('reassign_outlet',{p_user:id,p_restaurant:restaurant});await load()}}
              onReset={async(id)=>{const result=await resetCredentials(id);await load();return result}}
              onSetActive={async(id,active)=>{await rpc('set_account_active',{p_user:id,p_active:active});await load()}}
              users={users}
              restaurants={restaurants}
              onCreate={async (form) => {
                const result=await createEmployee(form);
                await load();
                return result;
              }}
            />
          )}
          {page === "form" && (
            <ReportForm
              key={`${scope}-${reportType}-${selectedSubmission?.id || selectedOccurrence?.id || "new"}`}
              type={reportType}
              restaurant={selectedRestaurant}
              profile={profile}
              occurrence={selectedOccurrence}
              status={
                selectedSubmission
                  ? "Submitted"
                  : stateOf(selectedOccurrence, now)
              }
              report={selectedSubmission}
              reports={reports}
              onOpenSource={sourceReport}
              date={
                selectedSubmission?.business_date ||
                selectedOccurrence?.business_date ||
                date
              }
              onSubmit={submit}
              onDraft={saveDraft}
              notify={notify}
              onBack={() => nav("overview")}
            />
          )}

          {page === "account" && (
            <section className="surface account-panel">
              <ShieldCheck size={30} />
              <h2>{profile.name}</h2>
              <p>
                {admin ? "Administrator" : "Restaurant manager"} ·{" "}
                {admin ? "All restaurants" : selectedRestaurant?.name}
              </p>
              <dl>
                <dt>Environment</dt>
                <dd>{"Supabase authenticated"}</dd>
                <dt>Database</dt>
                <dd>{supabase ? "Configured" : "Not connected"}</dd>
                <dt>Reporting timezone</dt>
                <dd>Asia/Kolkata {"· subject to configured policy"}</dd>
                <dt>Access</dt>
                <dd>{"Enforced by database row-level security"}</dd>
              </dl>
              <PasswordSettings profile={profile} />
              <button className="button dark" onClick={logout}>
                Switch account <LogOut size={14} />
              </button>
            </section>
          )}
          <footer className="page-footer">
            <span>
              <span className="tiny-dot" />
              {"Secure workspace"} <span className="footer-dot">·</span>{" "}
              Asia/Kolkata
            </span>
            <span>Care in every detail.</span>
          </footer>
        </main>
      </div>
      <nav className="bottom-dock glass" aria-label="Workspace navigation">
        {(limited ? [["smoke", "Smoke Test"], ["pest", "Pest Control"]] : [
          ["overview", "Overview"],
          ["reports", "Reports"],
          ["performance", "Performance"],
          ...(admin ? [["employees", "Employees"]] : []),
          ...(admin ? [["settings", "Settings"]] : []),
        ]).map(([key, label]) => (
          <button
            key={key}
            className={page === key ? "selected" : ""}
            onClick={() => nav(key)}
          >
            {label}
          </button>
        ))}
        <button
          className="dock-add"
          aria-label="New report"
          onClick={() => openForm("opening")}
        >
          <Plus size={18} />
        </button>
      </nav>
      {showNotifications && (
        <div className="notification-popover surface">
          <div className="panel-heading">
            <h3>Notifications</h3>
            <button
              className="icon-button"
              aria-label="Close notifications"
              onClick={() => setShowNotifications(false)}
            >
              <X size={16} />
            </button>
          </div>
          <p>{open} reports are awaited for the selected dates.</p>
          <ScoreAlertList alerts={scoreAlerts} users={users} restaurants={restaurants} admin={admin} />
          <p>
            {missed} reports missed for the selected dates.
          </p>
          <button
            className="text-button"
            onClick={() => {
              setShowNotifications(false);
              nav("reports");
            }}
          >
            Review reports <ArrowRight size={14} />
          </button>
        </div>
      )}
      {toast && (
        <div className="toast" role="status">
          <Check size={16} />
          {toast}
        </div>
      )}
    </div>
  );
}
function ScoreAlertList({alerts,users,restaurants,admin}) {
  return <div className="score-alert-list" aria-live="polite">{alerts.map(a=><div className="score-alert" key={a.id}>
    <TriangleAlert size={17}/><div><strong>{admin?(users.find(u=>u.id===a.manager_id)?.name||'Manager'):a.kind==='approaching_benchmark'?'Your score is close to the benchmark':'Your score is below the benchmark'}</strong>
    <p>{admin?`${restaurants.find(r=>r.id===a.restaurant_id)?.name||''} · `:''}{a.points} points · Benchmark {a.benchmark}.{a.kind==='approaching_benchmark'?` One more missed form could deduct up to ${a.next_deduction} points and take you below it.`:' Review the current reporting cycle.'}</p></div>
  </div>)}</div>;
}
export function DateRangePicker({ value, today=indiaDate(), onChange }) {
  const [draft,setDraft]=useState(value);
  const error=validateRange(draft.from,draft.to,today);
  return <form className="date-range-filter surface" onSubmit={e=>{e.preventDefault();if(!error)onChange(draft)}}>
    <div><strong>Reporting dates</strong><small>India time · Up to six months of history</small></div>
    <label>From<input type="date" required min={historyStart(today)} max={today} value={draft.from} onChange={e=>setDraft(p=>({...p,from:e.target.value}))}/></label>
    <label>To<input type="date" required min={draft.from||historyStart(today)} max={today} value={draft.to} onChange={e=>setDraft(p=>({...p,to:e.target.value}))}/></label>
    <button className="button dark small" disabled={!!error}>Apply dates</button>
    <button type="button" className="button outline small" onClick={()=>{const next={from:today,to:today};setDraft(next);onChange(next)}}>Today</button>
    {error&&<p className="error" role="alert">{error}</p>}
  </form>;
}
function RangeReportStatus({reports,occurrences,range,now}) {
  const s=summarizeRange({reports,occurrences,...range,now});
  return <span className="range-report-status">{s.scheduled||s.submitted ? <>{s.submitted} submitted · {s.awaited} awaited · {s.missed} missed</>:'No reports scheduled'}</span>;
}
export function ManagerRangeSummary({managers,restaurants,rangeLabel}) {
  return <section className="surface log-panel manager-range-summary">
    <div className="panel-heading"><div><h3>Manager summary</h3><p>{rangeLabel} · Points earned from submissions; resets do not erase this history.</p></div></div>
    <div className="table-scroll"><table><thead><tr><th>Manager</th><th>Restaurant</th><th>Submitted</th><th>Awaited</th><th>Missed</th><th>Points earned</th><th>Net point change</th></tr></thead><tbody>
      {managers.map(m=><tr key={m.id}><td><strong>{m.name}</strong></td><td>{restaurants.find(r=>r.id===m.restaurant_id)?.name||'Previous assignment'}</td><td>{m.submitted}</td><td>{m.awaited}</td><td>{m.missed}</td><td>{m.earned}</td><td>{m.net>0?'+':''}{m.net}</td></tr>)}
    </tbody></table>{!managers.length&&<div className="empty"><p>No manager activity in this range.</p></div>}</div>
  </section>;
}
function Stat({ icon: Icon, title, value, meta, status = "" }) {
  return (
    <section className="surface stat">
      <div className="stat-title">
        <span className={"stat-icon " + status}>
          <Icon size={15} />
        </span>
        {title}
        <ArrowUpRight size={13} />
      </div>
      <strong>{value}</strong>
      <span className={"stat-meta " + status}>
        {status === "positive" ? (
          <Check size={12} />
        ) : status === "negative" ? (
          <span className="dot" />
        ) : null}
        {meta}
      </span>
    </section>
  );
}
function ReportTable({ reports, restaurants, onOpen }) {
  return (
    <div className="table-scroll">
      <table>
        <thead>
          <tr>
            <th>Report</th>
            <th>Restaurant</th>
            <th>Submitted by</th>
            <th>Business date / shift</th>
            <th>Submitted at · IST</th>
            <th>Status</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {reports.map((r) => (
            <tr key={r.id}>
              <td>
                <strong>{labels[r.type]}</strong>
              </td>
              <td>{restaurants.find((x) => x.id === r.restaurant_id)?.name}</td>
              <td>{r.manager_name}</td>
              <td>
                {r.business_date} · {r.shift}
              </td>
              <td>
                {fmt(r.submitted_at, {
                  day: "numeric",
                  month: "short",
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </td>
              <td>
                <Badge status="Submitted" />
              </td>
              <td>
                <button
                  className="icon-button"
                  aria-label={`View ${labels[r.type]} by ${r.manager_name}`}
                  onClick={() => onOpen(r)}
                >
                  <Eye size={16} />
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {!reports.length && (
        <div className="empty">
          <FileText size={25} />
          <p>No reports match these filters.</p>
          <small>
            Submitted reports will appear here with manager and server
            timestamp.
          </small>
        </div>
      )}
    </div>
  );
}
function Performance({
  restaurants,
  ledger,
  reports,
  now,
  currentPoints,
  users,
  rangeLabel,
}) {
  return (
    <>
      <div className="section-toolbar">
        <h2>Manager accountability</h2>
        <span className="date-chip">
          <CalendarDays size={14} />
          {rangeLabel}
        </span>
      </div>
      <div className="surface performance">
        <div className="panel-heading">
          <div>
            <h3>A good service starts with consistency.</h3>
            <p>
              {
                "Current cycle scores start at zero and cannot go below zero. The summary above shows activity for your selected dates."
              }
            </p>
          </div>
          <ShieldCheck size={24} />
        </div>
        {users
          .filter((u) => u.role === "manager")
          .map((u) => ({
            ...restaurants.find((r) => r.id === u.restaurant_id),
            manager: u.name,
            managerId: u.id,
          }))
          .map((r, i) => (
            <div className="performance-row" key={r.managerId}>
              <span
                className="restaurant-monogram"
                style={{
                  "--outlet": r.color || "#8c7464",
                }}
              >
                {r.short || r.name.slice(0, 2)}
              </span>
              <div>
                <strong>{r.manager || "Manager assignment pending"}</strong>
                <small>{r.name}</small>
              </div>
              <div className="score-bar">
                <span
                  style={{
                    width: "0%",
                  }}
                />
              </div>
              <strong>
                {currentPoints(r.id, r.managerId)} <small>pts</small>
              </strong>
            </div>
          ))}
      </div>
      <section className="surface log-panel">
        <div className="panel-heading">
          <div>
            <h3>Points ledger</h3>
            <p>
              One entry per report occurrence. Previous cycles remain in history.
            </p>
          </div>
        </div>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Restaurant</th>
                <th>Reason</th>
                <th>Occurrence</th>
                <th>Points</th>
                <th>Recorded at</th>
              </tr>
            </thead>
            <tbody>
              {ledger.map((l, i) => (
                <tr key={l.id || i}>
                  <td>
                    {restaurants.find((r) => r.id === l.restaurant_id)?.name}
                  </td>
                  <td>
                    {l.reason === "submitted"
                      ? "On-time submission"
                      : l.reason === "adjustment"
                        ? "Admin adjustment" + (l.note ? ": " + l.note : "")
                        : "Missed required report"}
                  </td>
                  <td>{l.occurrence_id || "Manual"}</td>
                  <td>
                    {l.amount > 0 ? "+" : ""}
                    {l.amount}
                  </td>
                  <td>{fmt(l.created_at || now)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {!ledger.length && (
            <div className="empty">
              <ChartNoAxesCombined size={26} />
              <p>{"No point entries yet."}</p>
              <small>
                {"No penalties are created from unconfigured policies."}
              </small>
            </div>
          )}
        </div>
      </section>
    </>
  );
}
function Field({ label, children, wide = false, hint }) {
  return (
    <label className={wide ? "wide" : ""}>
      {label}
      {children}
      {hint && <small className="field-help">{hint}</small>}
    </label>
  );
}
function ReportForm({
  type,
  restaurant,
  profile,
  occurrence,
  status,
  report,
  reports,
  onOpenSource,
  date,
  onSubmit,
  onDraft,
  notify,
  onBack,
}) {
  const [data, setData] = useState(
      report?.data || {
        responses: {},
        business_date: date,
        shift: type === "opening" ? "Morning" : "Dinner",
        people: [
          {
            name: "",
            kind: "Guest",
            contact: "",
          },
        ],
        staff: [
          {
            name: "",
            acknowledged: false,
          },
        ],
        completed_by: "",
        verified_by: "",
        followup: [],
        flags: [],
      },
    ),
    [err, setErr] = useState(""),
    [busy, setBusy] = useState(false),
    [submitted, setSubmitted] = useState(report || null),
    [draftLoaded, setDraftLoaded] = useState(false),
    [uploading, setUploading] = useState(false);
  const locked =
      status !== "Open" ||
      !!submitted ||
      profile.role === "admin" ||
      occurrence?.manager_id !== profile.id,
    checklist = type === "opening" || type === "closing",
    rows = checklist
      ? templates[restaurant?.name]?.[type] || []
      : briefing.flatMap((g) => g.slice(1));
  const update = (key, value) =>
    setData((prev) => ({
      ...prev,
      [key]: value,
    }));
  const response = (i, patch) =>
    setData((prev) => ({
      ...prev,
      responses: {
        ...prev.responses,
        [i]: {
          ...prev.responses?.[i],
          ...patch,
        },
      },
    }));
  const addAnotherIncident = () => {
    const keys = [
      "incident_time",
      "area",
      "reported_by",
      "manager_on_duty",
      "incident_type",
      "narrative0",
      "narrative1",
      "answer0",
      "answer1",
    ];
    if (keys.some((k) => !data[k]?.trim())) {
      setErr("Complete this incident before adding another record.");
      return;
    }
    const fields = [
      ...keys,
      "incident_other",
      "people",
      "narrative2",
      "followup",
      "followup_other",
      "reporter_signoff",
      "manager_signoff",
    ];
    const incident = Object.fromEntries(fields.map((k) => [k, data[k]]));
    const reset = Object.fromEntries(
      fields.map((k) => [
        k,
        k === "people"
          ? [
              {
                name: "",
                kind: "Guest",
                contact: "",
              },
            ]
          : k === "followup"
            ? []
            : "",
      ]),
    );
    setData((prev) => ({
      ...prev,
      ...reset,
      incidents: [...(prev.incidents || []), incident],
    }));
    setErr("");
    notify(
      "Incident recorded in draft. Complete the next incident, then submit all records together.",
    );
  };
  const finished = checklist
    ? Object.values(data.responses || {}).filter((r) => r.status).length
    : 0;
  const previousClosing = (
    occurrence?.policy_snapshot?.approvals?.handover_rule ===
    "previous_service_day"
      ? reports
      : []
  )
    .filter(
      (r) =>
        r.restaurant_id === restaurant?.id &&
        r.type === "closing" &&
        r.business_date < date,
    )
    .sort((a, b) => b.business_date.localeCompare(a.business_date))[0];
  useEffect(() => {
    if (!supabase || !occurrence?.id || report) return;
    supabase
      .from("drafts")
      .select("data")
      .eq("occurrence_id", occurrence.id)
      .maybeSingle()
      .then(({ data: d, error }) => {
        if (error) setErr(error.message);
        else if (d?.data) setData(d.data);
        setDraftLoaded(true);
      });
  }, [occurrence?.id]);
  useEffect(() => {
    if (locked || !draftLoaded || !occurrence?.id) return;
    const timer = setTimeout(
      () => onDraft(data, true).catch((e) => setErr(e.message)),
      1800,
    );
    return () => clearTimeout(timer);
  }, [data, draftLoaded, locked]);
  async function submit(e) {
    e.preventDefault();
    setErr("");
    if (locked) return;
    const problem = checklist ? validateResponses(rows, data.responses) : null;
    if (problem) {
      setErr(problem);
      return;
    }
    if (!data.manager_ack) {
      setErr("Confirm your own manager verification before submitting.");
      return;
    }
    if (
      checklist &&
      (!data.completed_by || !data.completed_time || !data.verified_time)
    ) {
      setErr("Enter staff completion details and manager verification time.");
      return;
    }
    if (
      type === "briefing" &&
      (!data.briefing_by ||
        !data.start_time ||
        !data.ended_time ||
        rows.some((_, i) => !data.responses?.[i]?.done))
    ) {
      setErr("Complete every briefing point, facilitator and start/end times.");
      return;
    }
    setBusy(true);
    try {
      const result = await onSubmit(data);
      setSubmitted(result);
      notify("Report submitted on time" + "");
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  }
  const field = (name, label, inputType = "text", required = false) => (
    <Field label={label} key={name}>
      <input
        type={inputType}
        required={required && !locked}
        value={data[name] || ""}
        onChange={(e) => update(name, e.target.value)}
      />
    </Field>
  );
  return (
    <section className="surface form-panel">
      <div className="panel-heading">
        <div>
          <button className="text-button" onClick={onBack}>
            ← Back to overview
          </button>
          <h2>{restaurant?.name}</h2>
          <p>
            {date} · {type === "opening" ? "Morning" : "Evening"} · Asia/Kolkata{" "}
            {""}
          </p>
        </div>
        <Badge status={submitted ? "Submitted" : status} />
      </div>
      <div
        className={"window-banner " + (status === "Missed" ? "expired" : "")}
      >
        <Clock size={17} />
        <div>
          <strong>
            {submitted
              ? "Submitted and locked"
              : status === "Open"
                ? "Your reporting window is open"
                : status === "Missed"
                  ? "Deadline passed. This report is locked."
                  : status === "Not yet open"
                    ? "This report has not opened yet."
                    : "Policy not configured"}
          </strong>
          <span>
            {occurrence?.enabled
              ? `${fmt(occurrence.opens_at)} – ${fmt(occurrence.deadline)} IST · ${"Server time determines eligibility"}`
              : "An administrator must configure and approve this schedule before submission."}
            {submitted
              ? ` · Submitted by ${submitted.manager_name} at ${fmt(submitted.submitted_at)}`
              : ""}
          </span>
        </div>
        <Lock size={15} />
      </div>
      {type === "opening" && (
        <div className="handover">
          <Moon size={20} />
          <div>
            <strong>Closing checklist completed by</strong>
            <p>
              {previousClosing?.data?.completed_by
                ? `${previousClosing.data.completed_by} · ${previousClosing.business_date} · ${previousClosing.data.completed_time || "Time not recorded"}`
                : "Closing report not available"}
            </p>
            <small>
              {previousClosing?.data?.verified_by
                ? `Manager verification: ${previousClosing.data.verified_by} · ${previousClosing.data.verified_time || "Time not recorded"}`
                : "No verified closing attribution available."}{" "}
              {"Handover linkage awaits approved service-day policy."}
            </small>
            {previousClosing && (
              <button
                type="button"
                className="text-button"
                onClick={() => onOpenSource(previousClosing)}
              >
                View closing source <ArrowUpRight size={13} />
              </button>
            )}
          </div>
        </div>
      )}
      {checklist && (
        <div className="checklist-progress">
          <span>
            {finished} of {rows.length} checks completed
          </span>
          <div>
            <span
              style={{
                width: `${(finished / rows.length) * 100}%`,
              }}
            />
          </div>
          <small>D = Done · I = Issue · NA = Not applicable</small>
        </div>
      )}
      <form onSubmit={submit}>
        <fieldset disabled={locked || busy || uploading}>
          <div className="field-grid report-meta">
            <Field label="Restaurant">
              <input value={restaurant?.name || ""} readOnly />
            </Field>
            <Field label="Business date">
              <input value={date} readOnly />
            </Field>
            {field("shift", "Shift")}
            {field(
              type === "closing" ? "close_time" : "ready_time",
              type === "closing" ? "Close time" : "Ready / service time",
              "time",
            )}
          </div>
          {checklist && (
            <>
              <p className="form-instruction">
                Inspect the floor, review Issue / NA entries and assign
                follow-up. Escalate hazards immediately; leave unresolved issues
                marked as Issue.
              </p>
              <div className="checklist">
                {rows.map((text, i) => (
                  <div className="check-row" key={i}>
                    <div className="check-main">
                      <span className="row-number">
                        {String(i + 1).padStart(2, "0")}
                      </span>
                      <p>{text}</p>
                      <div
                        className="status-options"
                        role="group"
                        aria-label={`Item ${i + 1} status`}
                      >
                        {["D", "I", "NA"].map((s) => (
                          <button
                            type="button"
                            aria-pressed={data.responses?.[i]?.status === s}
                            className={
                              data.responses?.[i]?.status === s
                                ? "chosen " + s
                                : ""
                            }
                            key={s}
                            onClick={() =>
                              response(i, {
                                status: s,
                              })
                            }
                          >
                            {s}
                          </button>
                        ))}
                      </div>
                      <input
                        className="initials"
                        aria-label={`Item ${i + 1} checker initials`}
                        placeholder="Initials"
                        value={data.responses?.[i]?.initials || ""}
                        onChange={(e) =>
                          response(i, {
                            initials: e.target.value,
                          })
                        }
                      />
                      <button
                        type="button"
                        className={
                          "flag-button " +
                          (data.flags?.includes(i) ? "flagged" : "")
                        }
                        aria-label={`Highlight item ${i + 1} to director`}
                        aria-pressed={data.flags?.includes(i) || false}
                        title="Highlight to director"
                        onClick={() =>
                          update(
                            "flags",
                            data.flags?.includes(i)
                              ? data.flags.filter((x) => x !== i)
                              : [...(data.flags || []), i],
                          )
                        }
                      >
                        <Flag size={15} />
                      </button>
                    </div>
                    {data.flags?.includes(i) && (
                      <label className="highlight-note">
                        Director note for item {i + 1}
                        <input
                          maxLength={1000}
                          value={data.highlight_notes?.[i] || ""}
                          onChange={(e) =>
                            update("highlight_notes", {
                              ...data.highlight_notes,
                              [i]: e.target.value,
                            })
                          }
                        />
                      </label>
                    )}
                    {data.responses?.[i]?.status === "I" && (
                      <div className="issue-fields">
                        <Field label="Follow-up action">
                          <input
                            value={data.responses?.[i]?.action || ""}
                            onChange={(e) =>
                              response(i, {
                                action: e.target.value,
                              })
                            }
                          />
                        </Field>
                        <Field label="Owner">
                          <input
                            value={data.responses?.[i]?.owner || ""}
                            onChange={(e) =>
                              response(i, {
                                owner: e.target.value,
                              })
                            }
                          />
                        </Field>
                        <Field label="Due time">
                          <input
                            type="datetime-local"
                            value={data.responses?.[i]?.due || ""}
                            onChange={(e) =>
                              response(i, {
                                due: e.target.value,
                              })
                            }
                          />
                        </Field>
                      </div>
                    )}
                  </div>
                ))}
              </div>
              <h3 className="form-section-title">Completion & verification</h3>
              <div className="field-grid">
                {field(
                  "completed_by",
                  "Completed by (staff name)",
                  "text",
                  true,
                )}
                {field("completed_time", "Staff completion time", "time", true)}
                {field("verified_by", "Verified by (manager)", "text", true)}
                {field(
                  "verified_time",
                  "Manager verification time",
                  "time",
                  true,
                )}
              </div>
              <p className="form-instruction">
                Staff name and recorded time are attribution, not a digital
                staff signature. Each person must acknowledge their own work; a
                manager cannot sign for them.
              </p>
            </>
          )}
          {type === "incident" && (
            <>
              <p className="form-instruction">
                One record per incident. Write facts in time order and hand to
                the manager on duty the same day.
              </p>
              <label className="check-label no-incident">
                <input
                  type="checkbox"
                  checked={!!data.no_incident}
                  onChange={(e) => update("no_incident", e.target.checked)}
                />
                No incident to report {"(only usable after admin approval)"}
              </label>
              {!data.no_incident && (
                <>
                  {data.incidents?.map((incident, i) => (
                    <details className="saved-incident" key={i}>
                      <summary>
                        Incident {i + 1} · {incident.incident_type} ·{" "}
                        {incident.incident_time} · {incident.area}
                      </summary>
                      <p>{incident.narrative0}</p>
                      <p>Action: {incident.narrative1}</p>
                      <small>
                        {incident.reported_by} · Manager:{" "}
                        {incident.manager_on_duty}
                      </small>
                    </details>
                  ))}
                  {data.incidents?.length > 0 && (
                    <h3 className="form-section-title">
                      Incident {data.incidents.length + 1}
                    </h3>
                  )}
                  <div className="field-grid">
                    {field("incident_time", "Time of incident", "time", true)}
                    {field("area", "Area / table / station", "text", true)}
                    {field(
                      "reported_by",
                      "Reported by (name, role)",
                      "text",
                      true,
                    )}
                    {field("manager_on_duty", "Manager on duty", "text", true)}
                    <Field label="Incident type">
                      <select
                        required
                        value={data.incident_type || ""}
                        onChange={(e) =>
                          update("incident_type", e.target.value)
                        }
                      >
                        <option value="">Select type</option>
                        {[
                          "Guest complaint",
                          "Guest injury / illness",
                          "Food safety / hygiene",
                          "Staff injury",
                          "Equipment / property damage",
                          "Billing / cash issue",
                          "Theft / loss",
                          "Staff conduct",
                          "Other",
                        ].map((t) => (
                          <option key={t}>{t}</option>
                        ))}
                      </select>
                    </Field>
                    {data.incident_type === "Other" &&
                      field(
                        "incident_other",
                        "Other incident details",
                        "text",
                        true,
                      )}
                  </div>
                  <h3 className="form-section-title">People involved</h3>
                  {data.people?.map((p, i) => (
                    <div className="field-grid people-row" key={i}>
                      <Field label="Name">
                        <input
                          value={p.name}
                          onChange={(e) =>
                            update(
                              "people",
                              data.people.map((x, j) =>
                                j === i
                                  ? {
                                      ...x,
                                      name: e.target.value,
                                    }
                                  : x,
                              ),
                            )
                          }
                        />
                      </Field>
                      <Field label="Guest / Staff">
                        <select
                          value={p.kind}
                          onChange={(e) =>
                            update(
                              "people",
                              data.people.map((x, j) =>
                                j === i
                                  ? {
                                      ...x,
                                      kind: e.target.value,
                                    }
                                  : x,
                              ),
                            )
                          }
                        >
                          <option>Guest</option>
                          <option>Staff</option>
                        </select>
                      </Field>
                      <Field label="Contact / Role (private)">
                        <input
                          value={p.contact}
                          onChange={(e) =>
                            update(
                              "people",
                              data.people.map((x, j) =>
                                j === i
                                  ? {
                                      ...x,
                                      contact: e.target.value,
                                    }
                                  : x,
                              ),
                            )
                          }
                        />
                      </Field>
                    </div>
                  ))}
                  <button
                    className="text-button"
                    type="button"
                    onClick={() =>
                      update("people", [
                        ...(data.people || []),
                        {
                          name: "",
                          kind: "Guest",
                          contact: "",
                        },
                      ])
                    }
                  >
                    <Plus size={14} />
                    Add person
                  </button>
                  <div className="field-grid">
                    {[
                      "What happened (in order, with times)",
                      "Immediate action taken",
                      "Witnesses",
                    ].map((l, i) => (
                      <Field key={l} label={l} wide>
                        <textarea
                          required={i < 2 && !locked}
                          rows={3}
                          value={data["narrative" + i] || ""}
                          onChange={(e) =>
                            update("narrative" + i, e.target.value)
                          }
                        />
                      </Field>
                    ))}
                  </div>
                  <h3 className="form-section-title">Follow-up needed</h3>
                  <div className="checkbox-list">
                    {[
                      "Guest to be contacted",
                      "Owner / management informed",
                      "Repair / maintenance",
                      "Staff discussion",
                      "Other",
                    ].map((t) => (
                      <label className="check-label" key={t}>
                        <input
                          type="checkbox"
                          checked={data.followup?.includes(t) || false}
                          onChange={(e) =>
                            update(
                              "followup",
                              e.target.checked
                                ? [...(data.followup || []), t]
                                : data.followup.filter((x) => x !== t),
                            )
                          }
                        />
                        {t}
                      </label>
                    ))}
                  </div>
                  {data.followup?.includes("Other") &&
                    field("followup_other", "Other follow-up details")}
                  <div className="field-grid">
                    {["Photos taken", "Resolved on the day"].map((l, i) => (
                      <Field label={l} key={l}>
                        <select
                          value={data["answer" + i] || ""}
                          required
                          onChange={(e) => update("answer" + i, e.target.value)}
                        >
                          <option value="">Select</option>
                          <option>Yes</option>
                          <option>No</option>
                        </select>
                      </Field>
                    ))}
                    {field(
                      "reporter_signoff",
                      "Reporter acknowledgment (recorded name)",
                    )}
                    {field(
                      "manager_signoff",
                      "Manager acknowledgment (your own name)",
                    )}
                  </div>
                  <div className="window-banner">
                    <Info size={17} />
                    <span>
                      Evidence files are private and scoped to this report.
                      Management review requires an authorised reviewer.
                      Recorded names are not signatures.
                    </span>
                  </div>
                  {!locked && (
                    <button
                      type="button"
                      className="button outline"
                      onClick={addAnotherIncident}
                    >
                      <Plus size={14} />
                      Add another incident
                    </button>
                  )}
                </>
              )}
              <label>
                Management review (authorised reviewer only)
                <input
                  disabled
                  value={submitted?.data?.management_review || "Not reviewed"}
                />
              </label>
            </>
          )}
          {type === "briefing" && (
            <>
              <p className="form-instruction">
                Hold before service with all FOH staff on shift. Keep it to 10
                minutes. The manager fills the page; staff acknowledge
                individually.
              </p>
              <div className="field-grid">
                {field("briefing_by", "Briefing taken by", "text", true)}
                {field("start_time", "Start time", "time", true)}
                <Field label="Shift (Lunch / Dinner)">
                  <select
                    value={data.shift}
                    onChange={(e) => update("shift", e.target.value)}
                  >
                    <option>Lunch</option>
                    <option>Dinner</option>
                  </select>
                </Field>
                {field("ended_time", "Time ended", "time", true)}
              </div>
              {(() => {
                let index = 0;
                return briefing.map((group) => (
                  <div className="briefing-group" key={group[0]}>
                    <h3>{group[0]}</h3>
                    {group.slice(1).map((text) => {
                      const i = index++;
                      return (
                        <div className="briefing-row" key={text}>
                          <label className="check-label">
                            <input
                              type="checkbox"
                              checked={data.responses?.[i]?.done || false}
                              onChange={(e) =>
                                response(i, {
                                  done: e.target.checked,
                                })
                              }
                            />
                            {text}
                          </label>
                          <input
                            placeholder="Notes"
                            aria-label={`${text} notes`}
                            value={data.responses?.[i]?.notes || ""}
                            onChange={(e) =>
                              response(i, {
                                notes: e.target.value,
                              })
                            }
                          />
                        </div>
                      );
                    })}
                  </div>
                ));
              })()}
              <Field label="Special notes for today">
                <textarea
                  rows={3}
                  value={data.special_notes || ""}
                  onChange={(e) => update("special_notes", e.target.value)}
                />
              </Field>
              <h3 className="form-section-title">Staff present</h3>
              {data.staff?.map((s, i) => (
                <div className="staff-row" key={i}>
                  <input
                    aria-label={`Staff ${i + 1} name`}
                    placeholder="Staff name"
                    value={s.name}
                    onChange={(e) =>
                      update(
                        "staff",
                        data.staff.map((x, j) =>
                          j === i
                            ? {
                                ...x,
                                name: e.target.value,
                              }
                            : x,
                        ),
                      )
                    }
                  />
                  <span>
                    <Lock size={13} />
                    Individual acknowledgment pending
                  </span>
                </div>
              ))}
              <button
                className="text-button"
                type="button"
                onClick={() =>
                  update("staff", [
                    ...(data.staff || []),
                    {
                      name: "",
                      acknowledged: false,
                    },
                  ])
                }
              >
                <Plus size={14} />
                Add staff member
              </button>
              <p className="form-instruction">
                Names record attendance only. Staff signature collection
                requires individual verified staff sessions and remains
                unverified here.
              </p>
            </>
          )}
          {!locked && (
            <label className="check-label acknowledgment">
              <input
                type="checkbox"
                checked={data.manager_ack || false}
                onChange={(e) => {
                  update("manager_ack", e.target.checked);
                  if (e.target.checked) update("verified_by", profile.name);
                }}
              />
              I, {profile.name}, confirm my own manager verification. This does
              not sign for any staff member.
            </label>
          )}
        </fieldset>
        <Evidence
          occurrence={occurrence}
          locked={locked}
          onBusy={setUploading}
        />
        {err && (
          <div className="error" role="alert">
            {err}
          </div>
        )}
        <div className="form-actions">
          <span>
            {submitted
              ? "Submitted report · read only"
              : locked
                ? "Submission unavailable"
                : "Draft — not submitted"}
          </span>
          <div>
            {!locked && (
              <button
                className="button outline"
                type="button"
                disabled={busy}
                onClick={async () => {
                  try {
                    await onDraft(data);
                  } catch (e) {
                    setErr(e.message);
                  }
                }}
              >
                Save draft
              </button>
            )}
            <button
              className="button dark"
              type="submit"
              disabled={locked || busy || uploading}
            >
              {locked ? <Lock size={14} /> : <Check size={14} />}{" "}
              {busy
                ? "Submitting…"
                : submitted
                  ? "Submitted"
                  : locked
                    ? "Report locked"
                    : "Submit report"}
            </button>
          </div>
        </div>
      </form>
    </section>
  );
}
export function SettingsPage({ policies, restaurants, users, onSave,scoreSettings=[],scoreCycles=[],onSaveScoring,onResetPoints }) {
  const [rid, setRid] = useState(restaurants[0]?.id),
    [type, setType] = useState("opening"),
    [draft, setDraft] = useState(() => refreshPolicyDraft(null, rid, "opening", policies)),
    [err, setErr] = useState(""),
    [busy, setBusy] = useState(false);
  const form = draft.form;
  useEffect(()=>{if(!rid&&restaurants[0]?.id)setRid(restaurants[0].id)},[rid,restaurants]);
  useEffect(() => {
    setDraft((previous) => refreshPolicyDraft(previous, rid, type, policies));
  }, [rid, type, policies]);
  const set = (k, v) =>
    setDraft((p) => ({
      ...p,
      dirty: true,
      form: { ...p.form, [k]: v },
    }));
  return (
    <>
      <ScoringSettings key={rid} restaurant={restaurants.find(r=>r.id===rid)} settings={scoreSettings.find(s=>s.restaurant_id===rid)} cycle={scoreCycles.find(c=>c.id===scoreSettings.find(s=>s.restaurant_id===rid)?.current_cycle_id)} onSave={values=>onSaveScoring(rid,values)} onReset={()=>onResetPoints(rid)} />
      <div className="settings-layout">
        <section className="surface settings-panel">
          <div className="panel-heading">
            <div>
              <h3>Submission windows</h3>
              <p>Opening in the morning. Three reports in the evening.</p>
            </div>
            <SlidersHorizontal size={20} />
          </div>
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              setErr("");
              setBusy(true);
              try {
                if (form.start_time === form.end_time)
                  throw Error("Opening and closing times must differ.");
                await onSave(form);
                setDraft((p) => p.form === form ? { ...p, dirty: false } : p);
              } catch (e) {
                setErr(e.message);
              } finally {
                setBusy(false);
              }
            }}
          >
            <div className="field-grid">
              <Field label="Restaurant">
                <select value={rid} onChange={(e) => setRid(e.target.value)}>
                  {restaurants.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Report">
                <select value={type} onChange={(e) => setType(e.target.value)}>
                  {kinds.map((t) => (
                    <option key={t} value={t}>
                      {labels[t]}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Window opens">
                <input
                  required
                  type="time"
                  value={form.start_time || ""}
                  onChange={(e) => set("start_time", e.target.value)}
                />
              </Field>
              <Field label="Submission deadline">
                <input
                  required
                  type="time"
                  value={form.end_time || ""}
                  onChange={(e) => set("end_time", e.target.value)}
                />
              </Field>
              <Field label="Points" hint="Fixed for every report: +5 when submitted on time, -20 when missed. Everyone starts each cycle at 200 (maximum 200). A report scores once per business date.">
                <input readOnly value="+5 on time · −20 missed · start and cap 200" />
              </Field>
              <Field label="Reporting timezone">
                <select
                  value={form.timezone || "Asia/Kolkata"}
                  onChange={(e) => set("timezone", e.target.value)}
                >
                  <option>Asia/Kolkata</option>
                </select>
              </Field>
              <Field label="When must an incident report be submitted?" hint="Incident reports are required every day, even when nothing happened. The manager can select ‘No incidents’ in the form.">
                <select
                  value={form.incident_rule || ""}
                  required={type === "incident"}
                  onChange={(e) => set("incident_rule", e.target.value)}
                >
                  <option value="">Choose the incident reporting rule</option>
                  <option value="daily_declaration">
                    Every reporting day, including days with no incidents
                  </option>
                </select>
              </Field>
              <Field label="Which closing report should opening staff review?" hint="For opening reports: use the previous service day's closing report so the next team can follow up on unfinished work.">
                <select
                  value={form.handover_rule || ""}
                  onChange={(e) => set("handover_rule", e.target.value)}
                >
                  <option value="">To be confirmed</option>
                  <option value="previous_service_day">
                    Previous service day's closing report
                  </option>
                </select>
              </Field>
              <Field label="Manager responsible for this form">
                <select
                  value={form.manager_id || ""}
                  onChange={(e) => set("manager_id", e.target.value)}
                >
                  <option value="">Assign manager</option>
                  {users.find(u=>u.id===form.manager_id)?.active===false && <option value={form.manager_id} disabled>Deactivated manager — choose another</option>}
                  {users
                    .filter(
                      (u) => u.restaurant_id === rid && u.role === "manager" && u.active!==false,
                    )
                    .map((u) => (
                      <option key={u.id} value={u.id}>
                        {u.name}
                      </option>
                    ))}
                </select>
              </Field>
              <Field label="Start using this schedule on" hint="Choose tomorrow or a later date. Existing report deadlines will stay the same.">
                <input
                  type="date"
                  value={form.effective_from || ""}
                  required={true}
                  onChange={(e) => set("effective_from", e.target.value)}
                />
              </Field>
            </div>
            <p className="policy-help">All four reports are required every day once their schedules are active: one opening report in the morning, then closing, incident and briefing reports in the evening.</p>
            {
              <>
                <h3 className="form-section-title">
                  Confirm the rules before activating
                </h3>
                <p className="policy-help">These are confirmations by you, the admin. Tick each item after agreeing the rule with your team. All eight are required to activate this schedule; you can save without activating while you decide.</p>
                <div className="checkbox-list">
                  {[
                    ["calendar", "I have checked the daily reporting deadlines."],
                    ["points", "I have agreed the rewards and missed-report deductions."],
                    ["reset", "I have set the reset interval and manually started the points cycle."],
                    ["responsibility", "The assigned manager knows they must submit this form."],
                    ["incident", "The team knows to report incidents, including days with none."],
                    ["handover", "Opening staff know to review the previous closing report."],
                    ["director", "I have agreed who should review highlighted issues."],
                    ["retention", "I have agreed how long to keep records and who signs forms."],
                  ].map(([key, label]) => (
                    <label className="check-label" key={key}>
                      <input
                        type="checkbox"
                        checked={form.approvals?.[key] || false}
                        onChange={(e) =>
                          set("approvals", {
                            ...form.approvals,
                            [key]: e.target.checked,
                          })
                        }
                      />
                      {label}
                    </label>
                  ))}
                </div>
              </>
            }
            <div className="window-banner">
              <Clock size={18} />
              <span>
                If the deadline is earlier than the opening time, it falls on the next day. Changes start on your chosen date and do not change existing report deadlines.
              </span>
            </div>
            <label className="check-label">
              <input
                type="checkbox"
                checked={form.enabled || false}
                onChange={(e) => set("enabled", e.target.checked)}
              />
              {"Turn on this reporting schedule"}
            </label>
            {err && <p className="error">{err}</p>}
            <button className="button dark" disabled={busy}>
              {busy ? "Saving…" : "Save reporting schedule"}
              <Check size={15} />
            </button>
          </form>
        </section>
        <section className="surface policy-checklist">
          <div className="panel-heading">
            <div>
              <h3>Ready to activate?</h3>
              <p>Your confirmations for this reporting schedule</p>
            </div>
            <ShieldCheck size={20} />
          </div>
          {[
            "Daily reporting deadlines",
            "Rewards and deductions",
            "Points reset interval and manual start",
            "Manager assigned and informed",
            "Incident reporting understood",
            "Opening team handover understood",
            "Highlighted issue reviewers agreed",
            "Record keeping and signatures agreed",
          ].map((t, i) => (
            <div className="policy-item" key={t}>
              <span>{t}</span>
              <span className="tbc">
                {form.approvals?.[
                  [
                    "calendar",
                    "points",
                    "reset",
                    "responsibility",
                    "incident",
                    "handover",
                    "director",
                    "retention",
                  ][i]
                ]
                  ? "Confirmed"
                  : "Needs confirmation"}
              </span>
            </div>
          ))}
          <p className="policy-foot">
            {
              "To turn this schedule on, complete the required fields, start the points cycle, assign a manager and confirm all eight rules. Reports will be required every day. Leave ‘Turn on this reporting schedule’ unchecked to save without activating it."
            }
          </p>
        </section>
      </div>
    </>
  );
}
createRoot(document.getElementById("root")).render(<App />);
