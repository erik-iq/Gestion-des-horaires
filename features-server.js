import {
  monthSummary,
  overtimeBalance,
  defaultSchedule,
  fullAbsence,
  absenceLabel,
} from "./public/metrics.js";
import { createOperations } from "./operations-server.js";
import { shiftMonth, shiftDay } from "./public/calendar.js";
import { PDFDocument, rgb } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";

export function createFeatures(db, helpers) {
  const { today, fail, date, text, number, minutes, body, send, asset } =
    helpers;
  db.exec(`CREATE TABLE IF NOT EXISTS contracts(id INTEGER PRIMARY KEY,user_id INTEGER NOT NULL REFERENCES users(id),effective_from TEXT NOT NULL,schedule_json TEXT NOT NULL,opening_minutes INTEGER NOT NULL DEFAULT 0,inferred INTEGER NOT NULL DEFAULT 0,UNIQUE(user_id,effective_from));
 CREATE TABLE IF NOT EXISTS month_validations(id INTEGER PRIMARY KEY,user_id INTEGER NOT NULL REFERENCES users(id),month TEXT NOT NULL,snapshot_json TEXT NOT NULL,validated_by INTEGER NOT NULL REFERENCES users(id),validated_at TEXT NOT NULL,UNIQUE(user_id,month));
 CREATE TABLE IF NOT EXISTS audit_log(id INTEGER PRIMARY KEY,actor_id INTEGER REFERENCES users(id),subject_user_id INTEGER REFERENCES users(id),action TEXT NOT NULL,label TEXT NOT NULL,before_json TEXT,after_json TEXT,created_at TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS favorites(id INTEGER PRIMARY KEY,user_id INTEGER NOT NULL REFERENCES users(id),name TEXT NOT NULL,start TEXT NOT NULL,end TEXT NOT NULL,break_minutes INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS week_templates(id INTEGER PRIMARY KEY,user_id INTEGER NOT NULL REFERENCES users(id),name TEXT NOT NULL,pattern_json TEXT NOT NULL);
 CREATE INDEX IF NOT EXISTS audit_subject_date ON audit_log(subject_user_id,id DESC);`);
  function atomic(fn) {
    db.exec("BEGIN IMMEDIATE");
    try {
      const result = fn();
      db.exec("COMMIT");
      return result;
    } catch (e) {
      db.exec("ROLLBACK");
      throw e;
    }
  }
  function audit(actor, subject, action, label, before = null, after = null) {
    db.prepare(
      "INSERT INTO audit_log(actor_id,subject_user_id,action,label,before_json,after_json,created_at) VALUES(?,?,?,?,?,?,?)",
    ).run(
      actor,
      subject,
      action,
      label,
      before ? JSON.stringify(before) : null,
      after ? JSON.stringify(after) : null,
      new Date().toISOString(),
    );
  }
  function ensureContracts() {
    for (const u of db
      .prepare(
        "SELECT * FROM users WHERE id NOT IN (SELECT user_id FROM contracts)",
      )
      .all()) {
      const first =
        db
          .prepare("SELECT MIN(date) AS date FROM entries WHERE user_id=?")
          .get(u.id).date || today();
      db.prepare(
        "INSERT INTO contracts(user_id,effective_from,schedule_json,inferred) VALUES(?,?,?,1)",
      ).run(u.id, first, JSON.stringify(defaultSchedule(u.daily_hours)));
    }
  }
  ensureContracts();
  const operations = createOperations(db, {
    ...helpers,
    atomic,
    audit,
    assertUnlocked,
    assertPeriodUnlocked,
    extendInferred,
    writeEntry,
  });
  const contractRows = () =>
    db
      .prepare("SELECT * FROM contracts ORDER BY effective_from")
      .all()
      .map((c) => ({ ...c, schedule: JSON.parse(c.schedule_json) }));
  const lockRows = () =>
    db
      .prepare(
        "SELECT v.*,u.name AS validator FROM month_validations v JOIN users u ON u.id=v.validated_by ORDER BY month DESC",
      )
      .all()
      .map((l) => ({ ...l, snapshot: JSON.parse(l.snapshot_json) }));
  function supplement(u) {
    ensureContracts();
    return {
      ...operations.supplement(u),
      contracts: contractRows().filter(
        (c) => u.role === "admin" || c.user_id === u.id,
      ),
      locks: lockRows().filter((l) => u.role === "admin" || l.user_id === u.id),
      favorites: db
        .prepare("SELECT * FROM favorites WHERE user_id=? ORDER BY name")
        .all(u.id),
      week_templates: db
        .prepare("SELECT * FROM week_templates WHERE user_id=? ORDER BY name")
        .all(u.id)
        .map((t) => ({ ...t, pattern: JSON.parse(t.pattern_json) })),
    };
  }
  function locked(userId, month) {
    return !!db
      .prepare("SELECT id FROM month_validations WHERE user_id=? AND month=?")
      .get(userId, month);
  }
  function assertUnlocked(userId, day) {
    if (locked(userId, day.slice(0, 7)))
      fail(
        "Ce mois est validé et verrouillé. Un administrateur doit le rouvrir.",
        409,
      );
  }
  function assertPeriodUnlocked(userId, start, end) {
    for (let m = start.slice(0, 7); m <= end.slice(0, 7); m = shiftMonth(m, 1))
      assertUnlocked(userId, m + "-01");
  }
  function monthValue(v) {
    if (
      typeof v !== "string" ||
      !/^\d{4}-(0[1-9]|1[0-2])$/.test(v) ||
      v < "2000-01" ||
      v > "2100-12"
    )
      fail("Mois invalide.");
    return v;
  }
  function subject(u, id) {
    const target = db.prepare("SELECT * FROM users WHERE id=?").get(Number(id));
    if (!target) fail("Utilisateur introuvable.", 404);
    if (u.role !== "admin" && target.id !== u.id)
      fail("Accès non autorisé.", 403);
    return target;
  }
  function checkTime(b) {
    const start = minutes(b.start),
      end = minutes(b.end),
      pause = number(b.break_minutes, 0, 720);
    if (!Number.isInteger(pause) || end <= start || end - start <= pause)
      fail("La fin doit suivre le début et dépasser la pause.");
    return { start: b.start, end: b.end, break_minutes: pause };
  }
  function extendInferred(userId, day) {
    const first = db
      .prepare(
        "SELECT * FROM contracts WHERE user_id=? ORDER BY effective_from LIMIT 1",
      )
      .get(userId);
    if (first?.inferred && day < first.effective_from) {
      assertPeriodUnlocked(userId, day, first.effective_from);
      db.prepare("UPDATE contracts SET effective_from=? WHERE id=?").run(
        day,
        first.id,
      );
    }
  }
  function writeEntry(u, b) {
    const before = db
      .prepare("SELECT * FROM entries WHERE user_id=? AND date=?")
      .get(u.id, b.date);
    extendInferred(u.id, b.date);
    db.prepare(
      "INSERT INTO entries(user_id,date,start,end,break_minutes,note) VALUES(?,?,?,?,?,?) ON CONFLICT(user_id,date) DO UPDATE SET start=excluded.start,end=excluded.end,break_minutes=excluded.break_minutes,note=excluded.note",
    ).run(u.id, b.date, b.start, b.end, b.break_minutes, b.note);
    const after = db
      .prepare("SELECT * FROM entries WHERE user_id=? AND date=?")
      .get(u.id, b.date);
    if (
      !before ||
      before.start !== after.start ||
      before.end !== after.end ||
      before.break_minutes !== after.break_minutes ||
      before.note !== after.note
    )
      audit(
        u.id,
        u.id,
        before ? "entry.update" : "entry.create",
        `${before ? "Modification" : "Saisie"} du ${b.date}`,
        before || null,
        after,
      );
  }
  function updateDailyHours(actor, other, hours) {
    if (other.daily_hours === hours) return;
    ensureContracts();
    assertUnlocked(other.id, today());
    const current = contractRows()
      .filter((c) => c.user_id === other.id && c.effective_from <= today())
      .at(-1);
    const schedule = (current?.schedule || defaultSchedule(hours)).map((n) =>
      n ? Math.round(hours * 60) : 0,
    );
    db.prepare(
      "INSERT INTO contracts(user_id,effective_from,schedule_json) VALUES(?,?,?) ON CONFLICT(user_id,effective_from) DO UPDATE SET schedule_json=excluded.schedule_json,inferred=0",
    ).run(other.id, today(), JSON.stringify(schedule));
    audit(
      actor,
      other.id,
      "contract.update",
      "Modification de l’objectif quotidien",
      current ? { schedule: current.schedule } : null,
      { schedule, effective_from: today() },
    );
  }
  function reportData(target, month) {
    ensureContracts();
    const entries = db
        .prepare("SELECT * FROM entries WHERE user_id=? ORDER BY date")
        .all(target.id),
      leaves = db
        .prepare("SELECT * FROM leaves WHERE user_id=? ORDER BY start")
        .all(target.id),
      contracts = contractRows(),
      locks = lockRows();
    return {
      target,
      month,
      entries: entries.filter((e) => e.date.startsWith(month)),
      leaves: leaves.filter(
        (l) =>
          l.status === "approved" &&
          l.start <= shiftDay(shiftMonth(month, 1) + "-01", -1) &&
          l.end >= month + "-01",
      ),
      summary: monthSummary(
        target,
        entries,
        leaves,
        contracts,
        locks,
        month,
        today(),
      ),
      balance: overtimeBalance(
        target,
        entries,
        leaves,
        contracts,
        locks,
        today(),
        month,
      ),
    };
  }
  async function handle(req, res, url, u) {
    if (await operations.handle(req, res, url, u)) return true;
    const p = url.pathname,
      method = req.method;
    if (p === "/api/team-week" && method === "GET") {
      const start = date(url.searchParams.get("start") || today());
      if (start < "2000-01-01" || start > "2100-12-31") fail("Date invalide.");
      const end = shiftDay(start, 6);
      const users = db.prepare("SELECT id,name FROM users ORDER BY name").all();
      send(res, 200, {
        start,
        end,
        users,
        entries: db
          .prepare(
            "SELECT user_id,date,start,end,break_minutes FROM entries WHERE date BETWEEN ? AND ? ORDER BY date",
          )
          .all(start, end),
        leaves: db
          .prepare(
            "SELECT user_id,start,end,status,kind,portion FROM leaves WHERE status!='rejected' AND start<=? AND end>=?",
          )
          .all(end, start),
      });
      return true;
    }
    if (p === "/api/history" && method === "GET") {
      const offset = Math.max(0, Number(url.searchParams.get("offset")) || 0);
      const own = u.role !== "admin";
      const rows = db
        .prepare(
          `SELECT a.*,actor.name AS actor,subject.name AS subject FROM audit_log a LEFT JOIN users actor ON actor.id=a.actor_id LEFT JOIN users subject ON subject.id=a.subject_user_id ${own ? "WHERE a.subject_user_id=?" : ""} ORDER BY a.id DESC LIMIT 101 OFFSET ?`,
        )
        .all(...(own ? [u.id, offset] : [offset]));
      send(res, 200, {
        items: rows.slice(0, 100).map((r) => ({
          ...r,
          before: r.before_json ? JSON.parse(r.before_json) : null,
          after: r.after_json ? JSON.parse(r.after_json) : null,
        })),
        has_more: rows.length > 100,
      });
      return true;
    }
    if (p === "/api/entries/batch" && method === "POST") {
      const b = await body(req);
      if (
        !Array.isArray(b.entries) ||
        !b.entries.length ||
        b.entries.length > 62
      )
        fail("Choisissez entre 1 et 62 journées.");
      const seen = new Set(),
        prepared = b.entries.map((e) => {
          const d = date(e.date);
          if (d > today())
            fail("Les journées futures ne peuvent pas être saisies.");
          if (seen.has(d)) fail("Une date apparaît plusieurs fois.");
          seen.add(d);
          return { ...checkTime(e), date: d, note: text(e.note || "") };
        });
      const applied = [],
        skipped = [];
      db.exec("BEGIN IMMEDIATE");
      try {
        for (const e of prepared) {
          const has = db
            .prepare("SELECT id FROM entries WHERE user_id=? AND date=?")
            .get(u.id, e.date);
          const leave = fullAbsence(
            db
              .prepare(
                "SELECT * FROM leaves WHERE user_id=? AND status='approved' AND start<=? AND end>=?",
              )
              .all(u.id, e.date, e.date),
            u.id,
            e.date,
          );
          let reason = locked(u.id, e.date.slice(0, 7))
            ? "Mois verrouillé"
            : leave
              ? "Absence approuvée"
              : has && b.replace_existing !== true
                ? "Déjà renseignée"
                : null;
          if (operations.active(u.id)?.date === e.date)
            reason = "Pointage en cours";
          if (reason) {
            skipped.push({ date: e.date, reason });
            continue;
          }
          writeEntry(u, e);
          applied.push(e.date);
        }
        db.exec("COMMIT");
      } catch (e) {
        db.exec("ROLLBACK");
        throw e;
      }
      send(res, 200, {
        applied,
        skipped,
        message: `${applied.length} journée(s) enregistrée(s), ${skipped.length} ignorée(s).`,
      });
      return true;
    }
    const cm = p.match(/^\/api\/contracts\/(\d+)$/);
    if (cm && method === "POST") {
      if (u.role !== "admin") fail("Accès administrateur requis.", 403);
      const target = subject(u, cm[1]),
        b = await body(req),
        effective = date(b.effective_from);
      if (effective < "2000-01-01" || effective > "2100-12-31")
        fail("Choisissez une date entre 2000 et 2100.");
      if (
        !Array.isArray(b.schedule) ||
        b.schedule.length !== 7 ||
        b.schedule.some(
          (n) =>
            typeof n !== "number" || !Number.isInteger(n) || n < 0 || n > 960,
        ) ||
        !b.schedule.some((n) => n > 0)
      )
        fail(
          "Le contrat doit définir sept durées en minutes, avec au moins un jour travaillé.",
        );
      const last = db
        .prepare(
          "SELECT MAX(month) AS month FROM month_validations WHERE user_id=?",
        )
        .get(target.id).month;
      if (last && effective <= shiftDay(shiftMonth(last, 1) + "-01", -1))
        fail(
          "Ce contrat affecterait un mois validé. Rouvrez les mois concernés avant modification.",
          409,
        );
      const adjustment = Math.round(
        number(b.opening_hours || 0, -10000, 10000) * 60,
      );
      const before = db
        .prepare("SELECT * FROM contracts WHERE user_id=? AND effective_from=?")
        .get(target.id, effective);
      atomic(() => {
        db.prepare(
          "INSERT INTO contracts(user_id,effective_from,schedule_json,opening_minutes,inferred) VALUES(?,?,?,?,0) ON CONFLICT(user_id,effective_from) DO UPDATE SET schedule_json=excluded.schedule_json,opening_minutes=excluded.opening_minutes,inferred=0",
        ).run(target.id, effective, JSON.stringify(b.schedule), adjustment);
        const base = b.schedule.find((n) => n > 0) / 60;
        if (effective <= today())
          db.prepare("UPDATE users SET daily_hours=? WHERE id=?").run(
            base,
            target.id,
          );
        audit(
          u.id,
          target.id,
          "contract.update",
          "Contrat et ajustement du solde au " + effective,
          before
            ? {
                schedule: JSON.parse(before.schedule_json),
                opening_minutes: before.opening_minutes,
              }
            : null,
          {
            effective_from: effective,
            schedule: b.schedule,
            opening_minutes: adjustment,
          },
        );
      });
      send(res, 200, { ok: true });
      return true;
    }
    if (p === "/api/favorites" && method === "POST") {
      const b = await body(req),
        t = checkTime(b),
        name = text(b.name, 80);
      if (!name) fail("Donnez un nom au favori.");
      if (
        db
          .prepare("SELECT COUNT(*) AS n FROM favorites WHERE user_id=?")
          .get(u.id).n >= 20
      )
        fail("Maximum 20 favoris.");
      atomic(() => {
        db.prepare(
          "INSERT INTO favorites(user_id,name,start,end,break_minutes) VALUES(?,?,?,?,?)",
        ).run(u.id, name, t.start, t.end, t.break_minutes);
        audit(u.id, u.id, "favorite.create", "Création du favori " + name);
      });
      send(res, 201, { ok: true });
      return true;
    }
    const fm = p.match(/^\/api\/favorites\/(\d+)$/);
    if (fm && method === "DELETE") {
      const f = db
        .prepare("SELECT * FROM favorites WHERE id=? AND user_id=?")
        .get(fm[1], u.id);
      if (!f) fail("Favori introuvable.", 404);
      atomic(() => {
        db.prepare("DELETE FROM favorites WHERE id=?").run(f.id);
        audit(u.id, u.id, "favorite.delete", "Suppression du favori " + f.name);
      });
      send(res, 200, { ok: true });
      return true;
    }
    if (p === "/api/week-templates" && method === "POST") {
      const b = await body(req),
        name = text(b.name, 80);
      if (
        !name ||
        !Array.isArray(b.pattern) ||
        !b.pattern.length ||
        b.pattern.length > 7
      )
        fail("Semaine type invalide.");
      const days = new Set();
      const pattern = b.pattern.map((t) => {
        const weekday = number(t.weekday, 1, 7);
        if (!Number.isInteger(weekday) || days.has(weekday))
          fail("Chaque jour doit être unique.");
        days.add(weekday);
        return { weekday, ...checkTime(t) };
      });
      if (
        db
          .prepare("SELECT COUNT(*) AS n FROM week_templates WHERE user_id=?")
          .get(u.id).n >= 10
      )
        fail("Maximum 10 semaines types.");
      atomic(() => {
        db.prepare(
          "INSERT INTO week_templates(user_id,name,pattern_json) VALUES(?,?,?)",
        ).run(u.id, name, JSON.stringify(pattern));
        audit(
          u.id,
          u.id,
          "template.create",
          "Création de la semaine type " + name,
        );
      });
      send(res, 201, { ok: true });
      return true;
    }
    const tm = p.match(/^\/api\/week-templates\/(\d+)$/);
    if (tm && method === "DELETE") {
      const t = db
        .prepare("SELECT * FROM week_templates WHERE id=? AND user_id=?")
        .get(tm[1], u.id);
      if (!t) fail("Semaine type introuvable.", 404);
      atomic(() => {
        db.prepare("DELETE FROM week_templates WHERE id=?").run(t.id);
        audit(
          u.id,
          u.id,
          "template.delete",
          "Suppression de la semaine type " + t.name,
        );
      });
      send(res, 200, { ok: true });
      return true;
    }
    const vm = p.match(/^\/api\/validations\/(\d+)\/(\d{4}-\d{2})$/);
    if (vm && ["POST", "DELETE"].includes(method)) {
      if (u.role !== "admin") fail("Accès administrateur requis.", 403);
      const target = subject(u, vm[1]),
        month = monthValue(vm[2]);
      if (method === "POST") {
        if (month >= today().slice(0, 7))
          fail("Seuls les mois terminés peuvent être validés.");
        if (locked(target.id, month)) fail("Ce mois est déjà validé.", 409);
        if (operations.active(target.id)?.date.startsWith(month))
          fail("Un pointage est encore en cours dans ce mois.", 409);
        if (
          db
            .prepare(
              "SELECT id FROM leaves WHERE user_id=? AND status='pending' AND start<=? AND end>=?",
            )
            .get(
              target.id,
              shiftDay(shiftMonth(month, 1) + "-01", -1),
              month + "-01",
            )
        )
          fail(
            "Traitez les demandes d’absence de ce mois avant sa validation.",
            409,
          );
        const data = reportData(target, month);
        atomic(() => {
          db.prepare(
            "INSERT INTO month_validations(user_id,month,snapshot_json,validated_by,validated_at) VALUES(?,?,?,?,?)",
          ).run(
            target.id,
            month,
            JSON.stringify(data.summary),
            u.id,
            new Date().toISOString(),
          );
          audit(
            u.id,
            target.id,
            "month.validate",
            "Validation du mois " + month,
            null,
            data.summary,
          );
        });
        send(res, 200, { ok: true });
      } else {
        const b = await body(req),
          reason = text(b.reason, 300);
        if (reason.length < 3) fail("Un motif de réouverture est requis.");
        const old = db
          .prepare(
            "SELECT * FROM month_validations WHERE user_id=? AND month=?",
          )
          .get(target.id, month);
        if (!old) fail("Mois non verrouillé.", 404);
        atomic(() => {
          db.prepare("DELETE FROM month_validations WHERE id=?").run(old.id);
          audit(
            u.id,
            target.id,
            "month.reopen",
            "Réouverture du mois " + month,
            { snapshot: JSON.parse(old.snapshot_json) },
            { reason },
          );
        });
        send(res, 200, { ok: true });
      }
      return true;
    }
    if (p === "/api/report/pdf" && method === "GET") {
      const month = monthValue(url.searchParams.get("month")),
        id = url.searchParams.get("user") || u.id;
      const targets =
        id === "all"
          ? u.role === "admin"
            ? db.prepare("SELECT * FROM users ORDER BY name").all()
            : fail("Accès administrateur requis.", 403)
          : [subject(u, id)];
      const report = await makePdf(
        targets.map((t) => reportData(t, month)),
        month,
        asset,
      );
      res.writeHead(200, {
        "Content-Type": "application/pdf",
        "Cache-Control": "no-store",
        "Content-Disposition": `attachment; filename="Tempo-rapport-${month}.pdf"`,
      });
      res.end(Buffer.from(report));
      return true;
    }
    return false;
  }
  return {
    handle,
    atomic,
    audit,
    ensureContracts,
    supplement,
    assertUnlocked,
    assertPeriodUnlocked,
    assertNoClock: operations.assertNoClock,
    activeClock: operations.active,
    writeEntry,
    updateDailyHours,
    extendInferred,
  };
}

async function makePdf(reports, month, asset) {
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  const font = await pdf.embedFont(asset("assets/report-font.ttf"), {
      subset: true,
    }),
    logo = await pdf.embedPng(asset("assets/logo.png"));
  const blue = rgb(0.25, 0.33, 0.52),
    muted = rgb(0.43, 0.49, 0.59);
  pdf.setTitle("Tempo — Rapport mensuel " + month);
  pdf.setCreator("Tempo");
  for (const data of reports) {
    let page, y;
    const start = () => {
      page = pdf.addPage([595.28, 841.89]);
      y = 730;
      page.drawImage(logo, { x: 40, y: 758, width: 64, height: 54 });
      page.drawText("TEMPO · RAPPORT MENSUEL", {
        x: 120,
        y: 789,
        size: 15,
        font,
        color: blue,
      });
      page.drawText(
        new Intl.DateTimeFormat("fr-CH", {
          month: "long",
          year: "numeric",
        }).format(new Date(month + "-01T12:00:00Z")),
        { x: 120, y: 768, size: 10, font, color: muted },
      );
    };
    start();
    const line = (value, size = 10, color = blue) => {
      if (y < 70) start();
      page.drawText(String(value), { x: 40, y, size, font, color });
      y -= size + 11;
    };
    const duration = (n, signed = true) =>
      (signed ? (n < 0 ? "−" : n > 0 ? "+" : "") : "") +
      Math.floor(Math.abs(n) / 60) +
      "h" +
      String(Math.abs(n) % 60).padStart(2, "0");
    line(data.target.name, 16);
    line(data.target.email, 9, muted);
    line("Statut : " + (data.summary.locked ? "Mois validé" : "Provisoire"));
    line(
      `Travail : ${duration(data.summary.worked_minutes, false)}   Contrat : ${duration(data.summary.expected_minutes, false)}`,
    );
    line(
      `Crédit vacances : ${duration(data.summary.vacation_credit, false)}   Ajustements : ${duration(data.summary.adjustment_minutes)}`,
    );
    line(
      `Autres absences créditées : ${duration(data.summary.absence_credit || 0, false)}   Sans solde : ${duration(data.summary.unpaid_minutes || 0, false)}`,
      9,
    );
    line(
      `Écart du mois : ${duration(data.summary.delta_minutes)}   Solde cumulé : ${duration(data.balance.minutes)}`,
      11,
    );
    line(
      `${data.summary.missing_days} journée(s) non renseignée(s) · Calcul au ${data.summary.as_of || "—"}`,
      9,
      muted,
    );
    y -= 9;
    const columns = [40, 150, 240, 330, 430];
    const header = () => {
      page.drawRectangle({
        x: 35,
        y: y - 5,
        width: 525,
        height: 23,
        color: rgb(0.94, 0.95, 0.98),
      });
      ["Date", "Arrivée", "Départ", "Pause", "Temps net"].forEach((label, i) =>
        page.drawText(label, { x: columns[i], y, size: 10, font, color: blue }),
      );
      y -= 25;
    };
    header();
    for (const e of data.entries) {
      if (y < 90) {
        start();
        header();
      }
      const parse = (t) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3));
      [
        e.date,
        e.start,
        e.end,
        e.break_minutes + " min",
        duration(parse(e.end) - parse(e.start) - e.break_minutes, false),
      ].forEach((value, i) =>
        page.drawText(value, { x: columns[i], y, size: 9, font, color: blue }),
      );
      page.drawLine({
        start: { x: 35, y: y - 8 },
        end: { x: 560, y: y - 8 },
        thickness: 0.3,
        color: rgb(0.87, 0.9, 0.95),
      });
      y -= 23;
    }
    if (data.leaves.length) {
      y -= 10;
      line("Absences approuvées", 11);
      for (const l of data.leaves)
        line(`${l.start} — ${l.end} · ${absenceLabel(l)}`, 9);
    }
    y -= 20;
    if (y < 160) start();
    line(
      "Signature du collaborateur                         Signature du responsable",
      10,
    );
    page.drawLine({
      start: { x: 40, y: y - 38 },
      end: { x: 255, y: y - 38 },
      thickness: 0.5,
      color: muted,
    });
    page.drawLine({
      start: { x: 320, y: y - 38 },
      end: { x: 550, y: y - 38 },
      thickness: 0.5,
      color: muted,
    });
    y -= 68;
    line(
      "Lieu et date : ______________________________________________",
      9,
      muted,
    );
  }
  const pages = pdf.getPages();
  pages.forEach((p, i) =>
    p.drawText(`Tempo · ${i + 1}/${pages.length}`, {
      x: 470,
      y: 25,
      size: 8,
      font,
      color: muted,
    }),
  );
  return pdf.save();
}
