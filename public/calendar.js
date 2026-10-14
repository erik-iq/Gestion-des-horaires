// Calculs du calendrier en UTC : les changements d'heure ne décalent pas les dates.
export function monthDays(month) {
  const [year, index] = month.split("-").map(Number);
  const first = new Date(Date.UTC(year, index - 1, 1, 12));
  const offset = (first.getUTCDay() + 6) % 7;
  const count = new Date(Date.UTC(year, index, 0, 12)).getUTCDate();
  const cells = Math.ceil((offset + count) / 7) * 7;
  return Array.from({ length: cells }, (_, i) => {
    const d = new Date(first);
    d.setUTCDate(d.getUTCDate() - offset + i);
    return {
      date: d.toISOString().slice(0, 10),
      inMonth: i >= offset && i < offset + count,
      weekend: [0, 6].includes(d.getUTCDay()),
    };
  });
}
export function shiftMonth(month, offset) {
  const [year, index] = month.split("-").map(Number);
  return new Date(Date.UTC(year, index - 1 + offset, 1, 12))
    .toISOString()
    .slice(0, 7);
}
export function shiftDay(date, offset) {
  const d = new Date(date + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + offset);
  return d.toISOString().slice(0, 10);
}
export function workdays(start, end) {
  if (end < start) return 0;
  let count = 0;
  for (
    let d = new Date(start + "T12:00:00Z");
    d <= new Date(end + "T12:00:00Z");
    d.setUTCDate(d.getUTCDate() + 1)
  )
    if (![0, 6].includes(d.getUTCDay())) count++;
  return count;
}
export function entryMinutes(e) {
  const parse = (t) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3));
  return parse(e.end) - parse(e.start) - e.break_minutes;
}
export function indexCalendar(entries, leaves, userId, month) {
  const entriesByDate = new Map();
  for (const e of entries)
    if (e.user_id === userId) entriesByDate.set(e.date, e);
  const dates = monthDays(month);
  const leavesByDate = new Map();
  const periodsByDate = new Map();
  const absencesByDate = new Map();
  for (const l of leaves) {
    if (l.user_id !== userId || l.status === "rejected") continue;
    for (const day of dates)
      if (day.date >= l.start && day.date <= l.end) {
        let absences = absencesByDate.get(day.date) || [];
        const overlap = (other) =>
          !other.portion ||
          other.portion === "full" ||
          !l.portion ||
          l.portion === "full" ||
          other.portion === l.portion;
        if (
          l.status === "pending" &&
          absences.some(
            (other) => other.status === "approved" && overlap(other),
          )
        )
          continue;
        if (l.status === "approved")
          absences = absences.filter(
            (other) => other.status !== "pending" || !overlap(other),
          );
        absencesByDate.set(day.date, [...absences, l]);
        const current = periodsByDate.get(day.date);
        if (!current || l.status === "approved") {
          periodsByDate.set(day.date, l);
          if (!day.weekend) leavesByDate.set(day.date, l);
        }
      }
  }
  const monthlyEntries = [...entriesByDate.values()].filter((e) =>
    e.date.startsWith(month),
  );
  return {
    dates,
    entriesByDate,
    leavesByDate,
    periodsByDate,
    absencesByDate,
    monthlyEntries,
    minutes: monthlyEntries.reduce((n, e) => n + entryMinutes(e), 0),
    vacationDays: dates
      .filter((d) => d.inMonth && !d.weekend)
      .reduce(
        (n, d) =>
          n +
          (absencesByDate.get(d.date) || [])
            .filter(
              (l) =>
                l.status === "approved" && (!l.kind || l.kind === "vacation"),
            )
            .reduce(
              (n, l) => n + (!l.portion || l.portion === "full" ? 1 : 0.5),
              0,
            ),
        0,
      ),
    pendingDays: dates
      .filter((d) => d.inMonth && !d.weekend)
      .reduce(
        (n, d) =>
          n +
          (absencesByDate.get(d.date) || [])
            .filter((l) => l.status === "pending")
            .reduce(
              (n, l) => n + (!l.portion || l.portion === "full" ? 1 : 0.5),
              0,
            ),
        0,
      ),
  };
}
