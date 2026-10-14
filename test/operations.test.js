import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { createFeatures } from "../features-server.js";
import { entryMinutes } from "../public/calendar.js";
function fixture() {
  const db = new DatabaseSync(":memory:");
  db.exec(`CREATE TABLE users(id INTEGER PRIMARY KEY,name TEXT,email TEXT,role TEXT,allowance REAL,daily_hours REAL);
 CREATE TABLE entries(id INTEGER PRIMARY KEY,user_id INTEGER,date TEXT,start TEXT,end TEXT,break_minutes INTEGER,note TEXT,UNIQUE(user_id,date));
 CREATE TABLE leaves(id INTEGER PRIMARY KEY,user_id INTEGER,start TEXT,end TEXT,days REAL,status TEXT DEFAULT 'pending',note TEXT DEFAULT '');
 INSERT INTO users VALUES(1,'Direction','admin@example.ch','admin',25,8),(2,'Camille','camille@example.ch','user',25,8),(3,'Léa','lea@example.ch','user',25,8);`);
  let now = new Date("2026-10-14T08:00:00Z");
  const helpers = {
    today: () =>
      new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Zurich" }).format(
        now,
      ),
    now: () => now,
    fail: (message, status = 400) => {
      throw Object.assign(new Error(message), { status });
    },
    date: (v) => {
      assert.match(v, /^\d{4}-\d{2}-\d{2}$/);
      return v;
    },
    text: (v) => String(v),
    number: (v) => Number(v),
    minutes: (t) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3)),
    body: async (req) => req.payload,
    send: (res, status, data) => Object.assign(res, { status, data }),
  };
  let features = createFeatures(db, helpers);
  const request = async (p, payload, userId = 2, method = "POST") => {
    const res = {};
    try {
      assert.equal(
        await features.handle(
          { method, payload },
          res,
          new URL(p, "http://tempo.local"),
          db.prepare("SELECT * FROM users WHERE id=?").get(userId),
        ),
        true,
      );
    } catch (e) {
      res.status = e.status || 500;
      res.data = { error: e.message };
    }
    return res;
  };
  return {
    db,
    request,
    setNow: (v) => (now = new Date(v)),
    restart: () => (features = createFeatures(db, helpers)),
  };
}
test("Pointage : pauses exactes, persistance, confidentialité et écriture unique", async () => {
  const f = fixture();
  try {
    assert.equal(
      (await f.request("/api/clock", { action: "start" })).status,
      200,
    );
    assert.equal(
      (await f.request("/api/clock", { action: "start" })).status,
      409,
    );
    assert.equal(
      (await f.request("/api/clock", { action: "stop" })).status,
      400,
    );
    f.setNow("2026-10-14T09:00:00Z");
    assert.equal(
      (await f.request("/api/clock", { action: "pause" })).status,
      200,
    );
    assert.equal(
      (await f.request("/api/clock", { action: "pause" })).status,
      409,
    );
    f.restart();
    assert.equal(
      (await f.request("/api/clock", null, 2, "GET")).data.clock.paused_at,
      "2026-10-14T09:00:00.000Z",
    );
    assert.equal(
      (await f.request("/api/clock?user=2", null, 3, "GET")).data.clock,
      null,
    );
    f.setNow("2026-10-14T09:30:00Z");
    assert.equal(
      (await f.request("/api/clock", { action: "resume" })).status,
      200,
    );
    assert.equal(
      (await f.request("/api/clock", { action: "resume" })).status,
      409,
    );
    f.setNow("2026-10-14T12:00:00Z");
    assert.equal(
      (await f.request("/api/clock", { action: "stop" })).status,
      200,
    );
    const e = f.db.prepare("SELECT * FROM entries WHERE user_id=2").get();
    assert.equal(e.start, "10:00");
    assert.equal(e.end, "14:00");
    assert.equal(e.break_minutes, 30);
    assert.equal(entryMinutes(e), 210);
    assert.equal(
      (await f.request("/api/clock", { action: "stop" })).status,
      409,
    );
    assert.equal(
      (await f.request("/api/clock", { action: "start" })).status,
      409,
    );
    assert.equal(f.db.prepare("SELECT COUNT(*) AS n FROM entries").get().n, 1);
    assert.equal(
      f.db
        .prepare(
          "SELECT COUNT(*) AS n FROM audit_log WHERE action='clock.pause'",
        )
        .get().n,
      1,
    );
  } finally {
    f.db.close();
  }
});
test("Le pointage annulé n’écrit aucune heure, et le franchissement de minuit exige une correction", async () => {
  const f = fixture();
  try {
    await f.request("/api/clock", { action: "start" });
    f.setNow("2026-10-15T08:00:00Z");
    assert.equal(
      (await f.request("/api/clock", { action: "stop" })).status,
      409,
    );
    assert.equal(
      (await f.request("/api/clock", { action: "cancel" })).status,
      200,
    );
    assert.equal(f.db.prepare("SELECT COUNT(*) AS n FROM entries").get().n, 0);
    assert.equal(
      (await f.request("/api/clock", { action: "start" })).status,
      200,
    );
  } finally {
    f.db.close();
  }
});
test("Absences : quota réservé aux vacances, rétroactivité médicale et droits de validation", async () => {
  const f = fixture();
  try {
    for (const [kind, start] of [
      ["illness", "2026-10-12"],
      ["training", "2026-10-13"],
      ["travel", "2026-10-15"],
      ["unpaid", "2026-10-16"],
    ]) {
      assert.equal(
        (
          await f.request("/api/leaves", {
            kind,
            start,
            end: start,
            portion: "full",
          })
        ).status,
        201,
      );
      const l = f.db.prepare("SELECT * FROM leaves WHERE kind=?").get(kind);
      assert.equal(
        (
          await f.request(
            "/api/leaves/" + l.id,
            { status: "approved" },
            2,
            "PATCH",
          )
        ).status,
        403,
      );
      assert.equal(
        (
          await f.request(
            "/api/leaves/" + l.id,
            { status: "approved" },
            1,
            "PATCH",
          )
        ).status,
        200,
      );
    }
    assert.equal(
      f.db
        .prepare("SELECT SUM(days) AS n FROM leaves WHERE kind='vacation'")
        .get().n,
      null,
    );
    assert.equal(
      (
        await f.request("/api/leaves", {
          kind: "vacation",
          start: "2026-10-12",
          end: "2026-10-12",
        })
      ).status,
      400,
    );
    assert.equal(
      (
        await f.request("/api/leaves", {
          kind: "invalid",
          start: "2026-10-14",
          end: "2026-10-14",
        })
      ).status,
      400,
    );
    assert.equal(
      (
        await f.request("/api/leaves", {
          kind: "illness",
          portion: "morning",
          start: "2026-10-14",
          end: "2026-10-15",
        })
      ).status,
      400,
    );
    f.db.prepare("UPDATE users SET allowance=0 WHERE id=3").run();
    assert.equal(
      (
        await f.request(
          "/api/leaves",
          { kind: "illness", start: "2026-10-14", end: "2026-10-14" },
          3,
        )
      ).status,
      201,
    );
    assert.equal(
      (
        await f.request(
          "/api/leaves",
          { kind: "vacation", start: "2026-10-15", end: "2026-10-15" },
          3,
        )
      ).status,
      400,
    );
  } finally {
    f.db.close();
  }
});
test("Deux demi-journées distinctes sont autorisées, les chevauchements et le pointage d’une absence entière sont refusés", async () => {
  const f = fixture();
  try {
    for (const portion of ["morning", "afternoon"]) {
      assert.equal(
        (
          await f.request("/api/leaves", {
            kind: "vacation",
            start: "2026-10-14",
            end: "2026-10-14",
            portion,
          })
        ).status,
        201,
      );
      assert.equal(
        (
          await f.request("/api/leaves", {
            kind: "illness",
            start: "2026-10-14",
            end: "2026-10-14",
            portion,
          })
        ).status,
        400,
      );
    }
    for (const l of f.db.prepare("SELECT * FROM leaves").all()) {
      assert.equal(l.days, 0.5);
      assert.equal(
        (
          await f.request(
            "/api/leaves/" + l.id,
            { status: "approved" },
            1,
            "PATCH",
          )
        ).status,
        200,
      );
    }
    assert.equal(
      (await f.request("/api/clock", { action: "start" })).status,
      409,
    );
  } finally {
    f.db.close();
  }
});
test("Une demi-journée peut être validée avec du travail, sans convertir une journée travaillée en absence entière", async () => {
  const f = fixture();
  try {
    f.db
      .prepare(
        "INSERT INTO entries(user_id,date,start,end,break_minutes,note) VALUES(2,'2026-10-14','08:00','12:00',0,'')",
      )
      .run();
    for (const portion of ["morning", "afternoon"])
      await f.request("/api/leaves", {
        kind: "illness",
        start: "2026-10-14",
        end: "2026-10-14",
        portion,
      });
    const leaves = f.db.prepare("SELECT * FROM leaves").all();
    assert.equal(
      (
        await f.request(
          "/api/leaves/" + leaves[0].id,
          { status: "approved" },
          1,
          "PATCH",
        )
      ).status,
      200,
    );
    assert.equal(
      (
        await f.request(
          "/api/leaves/" + leaves[1].id,
          { status: "approved" },
          1,
          "PATCH",
        )
      ).status,
      400,
    );
  } finally {
    f.db.close();
  }
});
test("La clôture bloque les absences en attente et les pointages encore ouverts", async () => {
  const f = fixture();
  try {
    await f.request("/api/leaves", {
      kind: "illness",
      start: "2026-09-30",
      end: "2026-09-30",
    });
    assert.equal(
      (await f.request("/api/validations/2/2026-09", {}, 1)).status,
      409,
    );
    const leave = f.db.prepare("SELECT * FROM leaves").get();
    await f.request(
      "/api/leaves/" + leave.id,
      { status: "approved" },
      1,
      "PATCH",
    );
    await f.request("/api/clock", { action: "start" });
    f.db
      .prepare("UPDATE clock_sessions SET date='2026-09-30' WHERE user_id=2")
      .run();
    assert.equal(
      (await f.request("/api/validations/2/2026-09", {}, 1)).status,
      409,
    );
    await f.request("/api/clock", { action: "cancel" });
    assert.equal(
      (await f.request("/api/validations/2/2026-09", {}, 1)).status,
      200,
    );
    assert.equal(
      (
        await f.request("/api/leaves", {
          kind: "training",
          start: "2026-09-29",
          end: "2026-09-29",
        })
      ).status,
      409,
    );
  } finally {
    f.db.close();
  }
});
test("Terminer pendant une pause déduit aussi la pause en cours", async () => {
  const f = fixture();
  try {
    await f.request("/api/clock", { action: "start" });
    f.setNow("2026-10-14T09:00:00Z");
    await f.request("/api/clock", { action: "pause" });
    f.setNow("2026-10-14T12:00:00Z");
    assert.equal(
      (await f.request("/api/clock", { action: "stop" })).status,
      200,
    );
    const entry = f.db.prepare("SELECT * FROM entries WHERE user_id=2").get();
    assert.equal(entry.break_minutes, 180);
    assert.equal(entryMinutes(entry), 60);
  } finally {
    f.db.close();
  }
});
