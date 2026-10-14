import { entryMinutes, shiftMonth, shiftDay } from "./calendar.js";
export const defaultSchedule = (hours) =>
  [hours, hours, hours, hours, hours, 0, 0].map((n) => Math.round(n * 60));
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
    expected += minutes;
    if (minutes && !own.has(date)) {
      if (absence.some((l) => l.start <= date && l.end >= date))
        credit += minutes;
      else missing++;
    }
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
    expected_minutes: expected,
    vacation_credit: credit,
    adjustment_minutes: adjustment,
    delta_minutes: worked + credit - expected + adjustment,
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
