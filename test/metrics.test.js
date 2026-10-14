import { test } from "node:test";
import assert from "node:assert/strict";
import {
  monthSummary,
  overtimeBalance,
  signedDuration,
  defaultSchedule,
} from "../public/metrics.js";
const user = { id: 1, daily_hours: 8 },
  contracts = [
    {
      user_id: 1,
      effective_from: "2026-10-12",
      schedule: defaultSchedule(8),
      opening_minutes: 0,
    },
  ];
const entry = (date, end) => ({
  user_id: 1,
  date,
  start: "08:00",
  end,
  break_minutes: 60,
});
test("Le contrat, les pauses et les congés approuvés déterminent le solde", () => {
  const result = monthSummary(
    user,
    [entry("2026-10-12", "18:00"), entry("2026-10-14", "16:00")],
    [
      {
        user_id: 1,
        start: "2026-10-13",
        end: "2026-10-13",
        status: "approved",
      },
    ],
    contracts,
    [],
    "2026-10",
    "2026-10-14",
  );
  assert.equal(result.worked_minutes, 960);
  assert.equal(result.expected_minutes, 1440);
  assert.equal(result.vacation_credit, 480);
  assert.equal(result.delta_minutes, 0);
  assert.equal(result.missing_days, 0);
});
test("Les journées non saisies créent un déficit provisoire et les demandes en attente ne créditent rien", () => {
  const result = monthSummary(
    user,
    [entry("2026-10-12", "17:00")],
    [{ user_id: 1, start: "2026-10-13", end: "2026-10-14", status: "pending" }],
    contracts,
    [],
    "2026-10",
    "2026-10-14",
  );
  assert.equal(result.delta_minutes, -960);
  assert.equal(result.missing_days, 2);
  assert.equal(result.vacation_credit, 0);
});
test("Un contrat à temps partiel peut prévoir des horaires différents chaque jour", () => {
  const result = monthSummary(
    user,
    [],
    [],
    [
      {
        ...contracts[0],
        schedule: [480, 480, 240, 0, 480, 0, 0],
        opening_minutes: 120,
      },
    ],
    [],
    "2026-10",
    "2026-10-14",
  );
  assert.equal(result.expected_minutes, 1200);
  assert.equal(result.adjustment_minutes, 120);
  assert.equal(result.delta_minutes, -1080);
});
test("Les changements de contrat sont datés et ne modifient pas les jours antérieurs", () => {
  const result = monthSummary(
    user,
    [],
    [],
    [
      ...contracts,
      {
        user_id: 1,
        effective_from: "2026-10-14",
        schedule: defaultSchedule(4),
        opening_minutes: 0,
      },
    ],
    [],
    "2026-10",
    "2026-10-14",
  );
  assert.equal(result.expected_minutes, 1200);
});
test("Les totaux validés restent figés même si les données fournies changent", () => {
  const result = monthSummary(
    user,
    [],
    [],
    contracts,
    [
      {
        user_id: 1,
        month: "2026-10",
        snapshot: { delta_minutes: 90, worked_minutes: 300, missing_days: 0 },
      },
    ],
    "2026-10",
    "2026-11-10",
  );
  assert.equal(result.delta_minutes, 90);
  assert.equal(result.locked, true);
});
test("Le cumul utilise les snapshots mensuels et ignore les ajustements futurs", () => {
  const c = [
    {
      user_id: 1,
      effective_from: "2026-09-30",
      schedule: defaultSchedule(10),
      opening_minutes: 0,
    },
    {
      user_id: 1,
      effective_from: "2027-01-01",
      schedule: defaultSchedule(8),
      opening_minutes: 1000,
    },
  ];
  const balance = overtimeBalance(
    user,
    [entry("2026-10-01", "20:30")],
    [],
    c,
    [
      {
        user_id: 1,
        month: "2026-09",
        snapshot: { delta_minutes: 60, missing_days: 0 },
      },
    ],
    "2026-10-01",
  );
  assert.equal(balance.minutes, 150);
  assert.equal(signedDuration(-150), "−2h30");
});
test("Une journée de travail et un congé importé ne sont pas crédités deux fois", () => {
  const s = monthSummary(
    user,
    [entry("2026-10-12", "17:00")],
    [
      {
        user_id: 1,
        start: "2026-10-12",
        end: "2026-10-12",
        status: "approved",
      },
    ],
    contracts,
    [],
    "2026-10",
    "2026-10-12",
  );
  assert.equal(s.vacation_credit, 0);
  assert.equal(s.delta_minutes, 0);
});
