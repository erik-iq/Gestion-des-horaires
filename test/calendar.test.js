import { test } from "node:test";
import assert from "node:assert/strict";
import {
  monthDays,
  shiftMonth,
  shiftDay,
  indexCalendar,
  entryMinutes,
  workdays,
} from "../public/calendar.js";

test("Le calendrier commence lundi et affiche tous les jours du mois", () => {
  const days = monthDays("2026-10");
  assert.equal(days[0].date, "2026-09-28");
  assert.equal(days.length, 35);
  assert.equal(days.filter((d) => d.inMonth).length, 31);
  assert.equal(days.at(-1).date, "2026-11-01");
  assert.ok(
    days
      .filter((d) => d.weekend)
      .every((d) => [0, 6].includes(new Date(d.date).getUTCDay())),
  );
});
test("Février et les années bissextiles conservent les bonnes dates", () => {
  assert.equal(monthDays("2024-02").filter((d) => d.inMonth).length, 29);
  assert.equal(monthDays("2025-02").filter((d) => d.inMonth).length, 28);
  assert.equal(monthDays("2021-02").length, 28);
  assert.equal(monthDays("2026-08").length, 42);
});
test("La navigation franchit correctement une année et les changements d’heure", () => {
  assert.equal(shiftMonth("2026-12", 1), "2027-01");
  assert.equal(shiftMonth("2026-01", -1), "2025-12");
  assert.equal(shiftDay("2026-03-29", 1), "2026-03-30");
  assert.equal(shiftDay("2026-10-25", -1), "2026-10-24");
  assert.equal(shiftDay("2024-02-28", 1), "2024-02-29");
});
test("Les totaux mensuels déduisent les pauses et restent propres au collaborateur", () => {
  const entries = [
    {
      id: 1,
      user_id: 1,
      date: "2026-10-14",
      start: "08:00",
      end: "17:00",
      break_minutes: 60,
    },
    {
      id: 2,
      user_id: 2,
      date: "2026-10-14",
      start: "07:00",
      end: "19:00",
      break_minutes: 0,
    },
    {
      id: 3,
      user_id: 1,
      date: "2026-09-30",
      start: "08:00",
      end: "12:00",
      break_minutes: 15,
    },
  ];
  const data = indexCalendar(entries, [], 1, "2026-10");
  assert.equal(data.minutes, 480);
  assert.equal(data.monthlyEntries.length, 1);
  assert.equal(data.entriesByDate.get("2026-10-14").id, 1);
  assert.equal(entryMinutes(entries[2]), 225);
});
test("Les congés qui chevauchent deux mois excluent les week-ends et les refus", () => {
  const leaves = [
    {
      id: 1,
      user_id: 1,
      start: "2026-09-28",
      end: "2026-10-05",
      status: "approved",
    },
    {
      id: 2,
      user_id: 1,
      start: "2026-10-08",
      end: "2026-10-12",
      status: "pending",
    },
    {
      id: 3,
      user_id: 1,
      start: "2026-10-14",
      end: "2026-10-16",
      status: "rejected",
    },
    {
      id: 4,
      user_id: 2,
      start: "2026-10-20",
      end: "2026-10-21",
      status: "approved",
    },
  ];
  const data = indexCalendar([], leaves, 1, "2026-10");
  assert.equal(data.vacationDays, 3);
  assert.equal(data.pendingDays, 3);
  assert.equal(data.leavesByDate.has("2026-10-03"), false);
  assert.equal(data.periodsByDate.get("2026-10-03").status, "approved");
  assert.equal(data.leavesByDate.has("2026-10-14"), false);
  assert.equal(data.leavesByDate.has("2026-10-20"), false);
  assert.equal(workdays("2026-10-08", "2026-10-12"), 3);
});
test("Un congé approuvé prend la priorité sur un ancien état en attente", () => {
  const data = indexCalendar(
    [],
    [
      {
        id: 1,
        user_id: 1,
        start: "2026-10-14",
        end: "2026-10-14",
        status: "approved",
      },
      {
        id: 2,
        user_id: 1,
        start: "2026-10-14",
        end: "2026-10-14",
        status: "pending",
      },
    ],
    1,
    "2026-10",
  );
  assert.equal(data.leavesByDate.get("2026-10-14").status, "approved");
  assert.equal(data.vacationDays, 1);
  assert.equal(data.pendingDays, 0);
});
