import { absenceTypes, absenceLabel, fullAbsence } from "./public/metrics.js";
import { workdays } from "./public/calendar.js";

export function createOperations(db, h) {
  const {
    today,
    fail,
    date,
    text,
    body,
    send,
    atomic,
    audit,
    assertUnlocked,
    assertPeriodUnlocked,
    extendInferred,
    writeEntry,
  } = h;
  const columns = db
    .prepare("PRAGMA table_info(leaves)")
    .all()
    .map((c) => c.name);
  if (!columns.includes("kind"))
    db.exec(
      "ALTER TABLE leaves ADD COLUMN kind TEXT NOT NULL DEFAULT 'vacation'",
    );
  if (!columns.includes("portion"))
    db.exec(
      "ALTER TABLE leaves ADD COLUMN portion TEXT NOT NULL DEFAULT 'full'",
    );
  db.exec(`CREATE TABLE IF NOT EXISTS clock_sessions(
    id INTEGER PRIMARY KEY,user_id INTEGER NOT NULL REFERENCES users(id),date TEXT NOT NULL,
    started_at TEXT NOT NULL,paused_at TEXT,paused_ms INTEGER NOT NULL DEFAULT 0,
    finished_at TEXT,status TEXT NOT NULL DEFAULT 'active');
    CREATE UNIQUE INDEX IF NOT EXISTS clock_active_user ON clock_sessions(user_id) WHERE status='active';`);
  const active = (id) =>
    db
      .prepare(
        "SELECT * FROM clock_sessions WHERE user_id=? AND status='active'",
      )
      .get(id) || null;
  const allLeaves = (id) =>
    db.prepare("SELECT * FROM leaves WHERE user_id=?").all(id);
  const time = (timestamp) =>
    new Intl.DateTimeFormat("en-GB", {
      timeZone: "Europe/Zurich",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).format(new Date(timestamp));
  function assertNoClock(userId, day) {
    if (active(userId)?.date === day)
      fail(
        "Un pointage est en cours pour cette journée. Terminez-le ou annulez-le avant la saisie manuelle.",
        409,
      );
  }
  function vacationRemaining(userId, year) {
    const quota = db
      .prepare("SELECT allowance FROM users WHERE id=?")
      .get(userId).allowance;
    const used = db
      .prepare(
        "SELECT COALESCE(SUM(days),0) AS n FROM leaves WHERE user_id=? AND kind='vacation' AND status='approved' AND substr(start,1,4)=?",
      )
      .get(userId, year).n;
    return quota - used;
  }
  function collision(userId, start, end, portion) {
    return db
      .prepare(
        "SELECT * FROM leaves WHERE user_id=? AND status!='rejected' AND start<=? AND end>=?",
      )
      .all(userId, end, start)
      .some(
        (l) =>
          portion === "full" || l.portion === "full" || l.portion === portion,
      );
  }
  async function handle(req, res, url, u) {
    const p = url.pathname,
      method = req.method;
    if (p === "/api/leaves" && method === "POST") {
      const b = await body(req),
        start = date(b.start),
        end = date(b.end);
      const kind = b.kind || "vacation",
        portion = b.portion || "full";
      if (
        !Object.hasOwn(absenceTypes, kind) ||
        !["full", "morning", "afternoon"].includes(portion)
      )
        fail("Type ou durée d’absence invalide.");
      if (end < start || start.slice(0, 4) !== end.slice(0, 4))
        fail("Choisissez une période dans la même année.");
      if (portion !== "full" && start !== end)
        fail("Une demi-journée doit concerner une seule date.");
      if (kind === "vacation" && start < today())
        fail("La demande doit commencer aujourd’hui ou plus tard.");
      assertPeriodUnlocked(u.id, start, end);
      const days = workdays(start, end) * (portion === "full" ? 1 : 0.5);
      if (!days) fail("La période doit inclure un jour ouvré.");
      if (collision(u.id, start, end, portion))
        fail("Cette période chevauche une demande existante.");
      if (kind === "vacation") {
        const pending = db
          .prepare(
            "SELECT COALESCE(SUM(days),0) AS n FROM leaves WHERE user_id=? AND kind='vacation' AND status='pending' AND substr(start,1,4)=?",
          )
          .get(u.id, start.slice(0, 4)).n;
        if (days > vacationRemaining(u.id, start.slice(0, 4)) - pending)
          fail("Solde insuffisant, demandes en attente incluses.");
      }
      const after = {
        user_id: u.id,
        start,
        end,
        days,
        kind,
        portion,
        note: text(b.note || ""),
      };
      atomic(() => {
        db.prepare(
          "INSERT INTO leaves(user_id,start,end,days,kind,portion,note) VALUES(?,?,?,?,?,?,?)",
        ).run(u.id, start, end, days, kind, portion, after.note);
        audit(
          u.id,
          u.id,
          "leave.create",
          "Demande · " + absenceLabel(after),
          null,
          after,
        );
      });
      send(res, 201, { ok: true });
      return true;
    }
    const lm = p.match(/^\/api\/leaves\/(\d+)$/);
    if (lm && ["PATCH", "DELETE"].includes(method)) {
      const l = db.prepare("SELECT * FROM leaves WHERE id=?").get(lm[1]);
      if (!l) fail("Demande introuvable.", 404);
      if (method === "DELETE") {
        if (l.user_id !== u.id || l.status !== "pending")
          fail("Seule votre demande en attente peut être annulée.", 403);
        assertPeriodUnlocked(l.user_id, l.start, l.end);
        atomic(() => {
          db.prepare("DELETE FROM leaves WHERE id=?").run(l.id);
          audit(
            u.id,
            l.user_id,
            "leave.cancel",
            "Annulation · " + absenceLabel(l),
            l,
            null,
          );
        });
      } else {
        if (u.role !== "admin") fail("Accès réservé aux administrateurs.", 403);
        const b = await body(req);
        if (!["approved", "rejected"].includes(b.status))
          fail("Statut invalide.");
        if (l.status !== "pending")
          fail("Cette demande a déjà été traitée.", 409);
        assertPeriodUnlocked(l.user_id, l.start, l.end);
        if (b.status === "approved") {
          if (
            l.kind === "vacation" &&
            l.days > vacationRemaining(l.user_id, l.start.slice(0, 4))
          )
            fail("Solde de vacances insuffisant.");
          const clock = active(l.user_id);
          if (clock && clock.date >= l.start && clock.date <= l.end)
            fail("Un pointage est en cours sur cette période.", 409);
          if (
            l.portion === "full" &&
            db
              .prepare(
                "SELECT id FROM entries WHERE user_id=? AND date BETWEEN ? AND ?",
              )
              .get(l.user_id, l.start, l.end)
          )
            fail(
              "Des heures existent sur cette période. Corrigez-les avant validation.",
            );
          // Two approved halves cover a whole day, which cannot coexist with recorded work.
          if (
            l.portion !== "full" &&
            db
              .prepare("SELECT id FROM entries WHERE user_id=? AND date=?")
              .get(l.user_id, l.start) &&
            allLeaves(l.user_id).some(
              (x) =>
                x.id !== l.id &&
                x.status === "approved" &&
                x.start <= l.start &&
                x.end >= l.start,
            )
          )
            fail(
              "Les deux demi-journées couvriraient une journée déjà travaillée.",
            );
        }
        atomic(() => {
          if (b.status === "approved" && l.start < today())
            extendInferred(l.user_id, l.start);
          db.prepare("UPDATE leaves SET status=? WHERE id=?").run(
            b.status,
            l.id,
          );
          audit(
            u.id,
            l.user_id,
            "leave." + b.status,
            absenceLabel(l) +
              (b.status === "approved" ? " · approuvée" : " · refusée"),
            l,
            { ...l, status: b.status },
          );
        });
      }
      send(res, 200, { ok: true });
      return true;
    }
    if (p === "/api/clock" && method === "GET") {
      send(res, 200, { clock: active(u.id), server_now: Date.now() });
      return true;
    }
    if (p === "/api/clock" && method === "POST") {
      const b = await body(req),
        now = (h.now?.() || new Date()).toISOString(),
        day = today();
      if (!["start", "pause", "resume", "stop", "cancel"].includes(b.action))
        fail("Action de pointage invalide.");
      const clock = active(u.id);
      if (b.action === "start") {
        if (clock) fail("Un pointage est déjà en cours.", 409);
        assertUnlocked(u.id, day);
        if (
          db
            .prepare("SELECT id FROM entries WHERE user_id=? AND date=?")
            .get(u.id, day)
        )
          fail(
            "Cette journée est déjà renseignée. Modifiez-la dans vos horaires.",
            409,
          );
        if (fullAbsence(allLeaves(u.id), u.id, day))
          fail("Une absence approuvée couvre cette journée.", 409);
        atomic(() => {
          db.prepare(
            "INSERT INTO clock_sessions(user_id,date,started_at) VALUES(?,?,?)",
          ).run(u.id, day, now);
          audit(u.id, u.id, "clock.start", "Début du pointage", null, {
            date: day,
            started_at: now,
          });
        });
      } else {
        if (!clock) fail("Aucun pointage en cours.", 409);
        assertUnlocked(u.id, clock.date);
        if (b.action === "pause" && clock.paused_at)
          fail("La pause est déjà en cours.", 409);
        if (b.action === "resume" && !clock.paused_at)
          fail("Aucune pause en cours.", 409);
        if (b.action === "stop" && clock.date !== day)
          fail(
            "Ce pointage dépasse minuit. Annulez-le puis répartissez vos heures manuellement sur les deux journées.",
            409,
          );
        const paused =
          clock.paused_ms +
          (clock.paused_at
            ? Math.max(0, Date.parse(now) - Date.parse(clock.paused_at))
            : 0);
        let entry;
        if (b.action === "stop") {
          const start = time(clock.started_at),
            end = time(now);
          const parse = (t) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3));
          const break_minutes = Math.floor(paused / 60000);
          if (parse(end) - parse(start) <= break_minutes)
            fail(
              "Au moins une minute travaillée est nécessaire pour enregistrer le pointage.",
            );
          if (fullAbsence(allLeaves(u.id), u.id, day))
            fail("Une absence approuvée couvre cette journée.", 409);
          if (
            db
              .prepare("SELECT id FROM entries WHERE user_id=? AND date=?")
              .get(u.id, day)
          )
            fail(
              "Des heures ont déjà été enregistrées pour cette journée.",
              409,
            );
          entry = {
            date: day,
            start,
            end,
            break_minutes,
            note: "Pointage automatique",
          };
        }
        atomic(() => {
          if (b.action === "pause")
            db.prepare("UPDATE clock_sessions SET paused_at=? WHERE id=?").run(
              now,
              clock.id,
            );
          if (b.action === "resume")
            db.prepare(
              "UPDATE clock_sessions SET paused_at=NULL,paused_ms=? WHERE id=?",
            ).run(paused, clock.id);
          if (["stop", "cancel"].includes(b.action))
            db.prepare(
              "UPDATE clock_sessions SET status=?,finished_at=?,paused_at=NULL,paused_ms=? WHERE id=?",
            ).run(
              b.action === "stop" ? "finished" : "cancelled",
              now,
              paused,
              clock.id,
            );
          if (entry) writeEntry(u, entry);
          audit(
            u.id,
            u.id,
            "clock." + b.action,
            {
              pause: "Début de pause",
              resume: "Reprise du pointage",
              stop: "Fin du pointage",
              cancel: "Annulation du pointage",
            }[b.action],
            clock,
            db.prepare("SELECT * FROM clock_sessions WHERE id=?").get(clock.id),
          );
        });
      }
      send(res, 200, { ok: true, clock: active(u.id), server_now: Date.now() });
      return true;
    }
    return false;
  }
  return {
    handle,
    active,
    assertNoClock,
    supplement: (u) => ({ clock: active(u.id), server_now: Date.now() }),
  };
}
