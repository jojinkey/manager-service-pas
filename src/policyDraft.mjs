// Default windows (IST). Evening reports run 9 pm to 11:30 am next day and count against the previous evening.
export const defaultWindow = (type) => type === "opening" ? { start_time: "11:30", end_time: "14:33" } : { start_time: "21:00", end_time: "11:30" };
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
      incident_rule: existing.incident_rule || existing.approvals?.incident_rule,
      handover_rule: existing.handover_rule || existing.approvals?.handover_rule,
    } : {
      restaurant_id: rid, type, ...defaultWindow(type), reward: 5,
      missed_penalty: 20, enabled: false, timezone: "Asia/Kolkata",
      approvals: {},
    },
  };
}
