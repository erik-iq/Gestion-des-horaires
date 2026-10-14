import { entryMinutes, shiftMonth, shiftDay } from "./calendar.js";
export const defaultSchedule = (hours) =>
  [hours, hours, hours, hours, hours, 0, 0].map((n) => Math.round(n * 60));
export const absenceTypes = {
  vacation: "Vacances",
  illness: "Maladie",
  training: "Formation",
  travel: "Déplacement",
  unpaid: "Congé sans solde",
};
export const absenceFraction = (leave) =>
  !leave.portion || leave.portion === "full" ? 1 : 0.5;
export const absenceLabel = (leave) =>
  (absenceTypes[leave.kind || "vacation"] || "Absence") +
  (leave.portion === "morning"
    ? " · matin"
    : leave.portion === "afternoon"
      ? " · après-midi"
      : "");
export function approvedOn(leaves, userId, date) {
  return leaves.filter(
    (l) =>
      l.user_id === userId &&
      l.status === "approved" &&
      l.start <= date &&
      l.end >= date,
  );
}
export function fullAbsence(leaves, userId, date) {
  return (
    approvedOn(leaves, userId, date).reduce(
      (n, l) => n + absenceFraction(l),
      0,
    ) >= 1
  );
}
export function scheduleFor(contracts, userId, date) {
  let found = null;
  for (const c of contracts)
    if (
      c.user_id === userId &&
      c.effective_from <= date &&
      (!found || c.effective_from > found.effective_from)
    )
      found = c;
  return found;
}
export function monthSummary(
  user,
  entries,
  leaves,
  contracts,
  locks,
  month,
  today,
) {
  const lock = locks.find((l) => l.user_id === user.id && l.month === month);
  if (lock) return { ...lock.snapshot, locked: true, validation: lock };
  const first = month + "-01",
    last = shiftDay(shiftMonth(month, 1) + "-01", -1),
    through = last < today ? last : today;
  const own = new Map(
    entries
      .filter(
        (e) =>
          e.user_id === user.id &&
          e.date.startsWith(month) &&
          e.date <= through,
      )
      .map((e) => [e.date, e]),
  );
  const absence = leaves.filter(
    (l) =>
      l.user_id === user.id &&
      l.status === "approved" &&
      l.start <= last &&
      l.end >= first,
  );
  let expected = 0,
    credit = 0,
    otherCredit = 0,
    unpaid = 0,
    missing = 0,
    unconfigured = 0;
  for (let date = first; date <= through; date = shiftDay(date, 1)) {
    const contract = scheduleFor(contracts, user.id, date),
      weekday = (new Date(date + "T12:00:00Z").getUTCDay() + 6) % 7;
    if (!contract) {
      if (own.has(date)) unconfigured++;
      continue;
    }
    const minutes = contract.schedule[weekday] || 0;
    const dayLeaves = absence.filter((l) => l.start <= date && l.end >= date);
    let covered = 0;
    for (const l of dayLeaves) {
      const fraction = Math.min(absenceFraction(l), 1 - covered);
      const amount =
        Math.round(minutes * (covered + fraction)) -
        Math.round(minutes * covered);
      covered += fraction;
      if (l.kind === "unpaid") unpaid += amount;
      // Legacy full-day overlaps must not double-credit recorded work.
      else if (!own.has(date) || absenceFraction(l) < 1) {
        if (!l.kind || l.kind === "vacation") credit += amount;
        else otherCredit += amount;
      }
    }
    expected += minutes;
    if (minutes && !own.has(date) && covered < 1) missing++;
  }
  const worked = [...own.values()].reduce((n, e) => n + entryMinutes(e), 0),
    adjustment = contracts
      .filter(
        (c) =>
          c.user_id === user.id &&
          c.effective_from.startsWith(month) &&
          c.effective_from <= through,
      )
      .reduce((n, c) => n + c.opening_minutes, 0);
  return {
    month,
    user_id: user.id,
    worked_minutes: worked,
    expected_minutes: expected - unpaid,
    contractual_minutes: expected,
    vacation_credit: credit,
    absence_credit: otherCredit,
    unpaid_minutes: unpaid,
    adjustment_minutes: adjustment,
    delta_minutes:
      worked + credit + otherCredit - expected + unpaid + adjustment,
    missing_days: missing,
    unconfigured_days: unconfigured,
    recorded_days: own.size,
    as_of: through < first ? null : through,
    locked: false,
  };
}
export function overtimeBalance(
  user,
  entries,
  leaves,
  contracts,
  locks,
  today,
  untilMonth = today.slice(0, 7),
) {
  const first = contracts
    .filter((c) => c.user_id === user.id && c.effective_from <= today)
    .map((c) => c.effective_from.slice(0, 7))
    .sort()[0];
  if (!first) return { minutes: 0, missing_days: 0 };
  const end = untilMonth < today.slice(0, 7) ? untilMonth : today.slice(0, 7);
  let minutes = 0,
    missing = 0;
  for (let month = first; month <= end; month = shiftMonth(month, 1)) {
    const summary = monthSummary(
      user,
      entries,
      leaves,
      contracts,
      locks,
      month,
      today,
    );
    minutes += summary.delta_minutes;
    missing += summary.missing_days;
  }
  return { minutes, missing_days: missing };
}
export function signedDuration(minutes) {
  const amount = Math.abs(Math.round(minutes));
  return (
    (minutes < 0 ? "−" : minutes > 0 ? "+" : "") +
    Math.floor(amount / 60) +
    "h" +
    String(amount % 60).padStart(2, "0")
  );
}
export function weekDates(date) {
  const weekday = (new Date(date + "T12:00:00Z").getUTCDay() + 6) % 7,
    first = shiftDay(date, -weekday);
  return Array.from({ length: 7 }, (_, i) => shiftDay(first, i));
}
export function anomalies(
  user,
  entries,
  leaves,
  contracts,
  locks,
  today,
  month = today.slice(0, 7),
) {
  if (locks.some((l) => l.user_id === user.id && l.month === month)) return [];
  const own = new Map(
    entries.filter((e) => e.user_id === user.id).map((e) => [e.date, e]),
  );
  const result = [];
  const end = shiftDay(shiftMonth(month, 1) + "-01", -1);
  for (
    let date = month + "-01";
    date <= end && date <= today;
    date = shiftDay(date, 1)
  ) {
    const contract = scheduleFor(contracts, user.id, date);
    if (!contract) continue;
    const weekday = (new Date(date + "T12:00:00Z").getUTCDay() + 6) % 7;
    const expected = contract.schedule[weekday] || 0;
    const dayLeaves = approvedOn(leaves, user.id, date);
    const covered = Math.min(
      1,
      dayLeaves.reduce((n, l) => n + absenceFraction(l), 0),
    );
    const entry = own.get(date);
    if (!entry && expected && covered < 1 && date < today)
      result.push({ date, type: "missing", label: "Journée à compléter" });
    if (entry) {
      if (entryMinutes(entry) > 360 && entry.break_minutes < 30)
        result.push({
          date,
          type: "break",
          label: "Pause courte ou non renseignée",
        });
      const target = Math.round(expected * (1 - covered));
      if (entryMinutes(entry) > target + 60)
        result.push({
          date,
          type: "overtime",
          label: "Dépassement de l’objectif",
          minutes: entryMinutes(entry) - target,
        });
    }
  }
  return result;
}
