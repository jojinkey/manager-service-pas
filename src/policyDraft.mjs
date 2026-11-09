// Default windows (IST). Evening reports run 10:30 pm to 11:30 am next day and count against the previous evening.
export const defaultWindow = (type) => type === "opening" ? { start_time: "11:30", end_time: "14:30" } : { start_time: "22:30", end_time: "11:30" };
// Policy edits must start on a future service day (IST). Never pre-fill today or a past date.
export const earliestStart = (now = new Date()) => new Date(now.getTime() + 5.5 * 3600e3 + 86400e3).toISOString().slice(0, 10);
export function refreshPolicyDraft(previous, rid, type, policies) {
  // Polling and realtime updates must never replace work in progress.
  if (previous?.dirty && previous.rid === rid && previous.type === type)
    return previous;
  const existing = policies.find(
    (p) => p.restaurant_id === rid && p.type === type && p.current !== false,
  );
  return {
    rid, type, dirty: false,
    form: existing ? {
      ...existing,
      effective_from: !existing.effective_from || existing.effective_from < earliestStart() ? earliestStart() : existing.effective_from,
      incident_rule: existing.incident_rule || existing.approvals?.incident_rule,
      handover_rule: existing.handover_rule || existing.approvals?.handover_rule,
    } : {
      restaurant_id: rid, type, ...defaultWindow(type), reward: 5,
      missed_penalty: 20, enabled: false, effective_from: earliestStart(), timezone: "Asia/Kolkata",
      approvals: {},
    },
  };
}
