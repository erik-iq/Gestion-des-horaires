import http from "node:http";
import { DatabaseSync } from "node:sqlite";
import {
  randomBytes,
  scryptSync,
  timingSafeEqual,
  createHash,
} from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getAsset, isSea } from "node:sea";
import { spawn } from "node:child_process";
import os from "node:os";
const packaged = isSea();
const desktop = packaged || process.env.TEMPO_DESKTOP === "true";
const root = packaged
  ? path.dirname(process.execPath)
  : path.dirname(fileURLToPath(import.meta.url));
const desktopData =
  process.platform === "win32"
    ? path.join(
        process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local"),
        "Tempo",
      )
    : path.join(os.homedir(), ".local", "share", "Tempo");
const location =
  process.env.DB_PATH ||
  path.join(desktop ? desktopData : path.join(root, "data"), "horaires.sqlite");
const instanceId = createHash("sha256")
  .update(path.resolve(location))
  .digest("hex");
function log(message, error = false) {
  // Les exécutables graphiques Windows n'ont pas forcément de console.
  try {
    error ? console.error(message) : console.log(message);
  } catch {
    /* Pas de terminal attaché. */
  }
}
mkdirSync(path.dirname(location), { recursive: true });
const db = new DatabaseSync(location);
db.exec(`PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL;
CREATE TABLE IF NOT EXISTS users(id INTEGER PRIMARY KEY,name TEXT NOT NULL,email TEXT NOT NULL UNIQUE,password TEXT NOT NULL,role TEXT NOT NULL CHECK(role IN ('admin','user')),allowance REAL NOT NULL DEFAULT 25,daily_hours REAL NOT NULL DEFAULT 8);
CREATE TABLE IF NOT EXISTS entries(id INTEGER PRIMARY KEY,user_id INTEGER NOT NULL REFERENCES users(id),date TEXT NOT NULL,start TEXT NOT NULL,end TEXT NOT NULL,break_minutes INTEGER NOT NULL,note TEXT NOT NULL DEFAULT '',UNIQUE(user_id,date));
CREATE TABLE IF NOT EXISTS leaves(id INTEGER PRIMARY KEY,user_id INTEGER NOT NULL REFERENCES users(id),start TEXT NOT NULL,end TEXT NOT NULL,days INTEGER NOT NULL,status TEXT NOT NULL DEFAULT 'pending',note TEXT NOT NULL DEFAULT '');
CREATE INDEX IF NOT EXISTS idx_entries_date ON entries(date DESC);
CREATE INDEX IF NOT EXISTS idx_leaves_user_period ON leaves(user_id,start,end);
CREATE INDEX IF NOT EXISTS idx_leaves_status_period ON leaves(status,start,end);`);
const sessions = new Map(),
  attempts = new Map();
const safeUser = (u) => ({
  id: u.id,
  name: u.name,
  email: u.email,
  role: u.role,
  allowance: u.allowance,
  daily_hours: u.daily_hours,
});
function hash(password) {
  const salt = randomBytes(16).toString("hex");
  return salt + ":" + scryptSync(password, salt, 64).toString("hex");
}
function matches(password, value) {
  const [salt, h] = value.split(":");
  return timingSafeEqual(scryptSync(password, salt, 64), Buffer.from(h, "hex"));
}
function fail(message, status = 400) {
  throw Object.assign(new Error(message), { status });
}
function text(v, max = 500) {
  if (typeof v !== "string" || v.length > max) fail("Texte invalide.");
  return v.trim();
}
function date(v) {
  if (
    typeof v !== "string" ||
    !/^\d{4}-\d{2}-\d{2}$/.test(v) ||
    Number.isNaN(Date.parse(v)) ||
    new Date(v).toISOString().slice(0, 10) !== v
  )
    fail("Date invalide.");
  return v;
}
function credentials(b) {
  const name = text(b.name, 100),
    email = text(b.email, 200).toLowerCase();
  if (!name || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
    fail("Nom et adresse e-mail valides requis.");
  if (
    typeof b.password !== "string" ||
    b.password.length < 10 ||
    b.password.length > 128
  )
    fail("Le mot de passe doit contenir entre 10 et 128 caractères.");
  return { name, email, password: hash(b.password) };
}

// L'hébergement crée le premier administrateur avant d'ouvrir le serveur.
// Un redéploiement ne remplace jamais les comptes déjà enregistrés.
if (!db.prepare("SELECT id FROM users LIMIT 1").get()) {
  const email = process.env.BOOTSTRAP_ADMIN_EMAIL;
  const password = process.env.BOOTSTRAP_ADMIN_PASSWORD;
  if (email || password) {
    try {
      const c = credentials({
        name: process.env.BOOTSTRAP_ADMIN_NAME || "Administrateur",
        email,
        password,
      });
      db.prepare(
        "INSERT INTO users(name,email,password,role) VALUES(?,?,?,'admin')",
      ).run(c.name, c.email, c.password);
    } catch {
      log(
        "Création administrateur impossible : vérifiez BOOTSTRAP_ADMIN_EMAIL et BOOTSTRAP_ADMIN_PASSWORD (10 à 128 caractères).",
        true,
      );
      db.close();
      process.exit(1);
    }
  }
}
function number(v, min, max) {
  if (typeof v !== "number" || !Number.isFinite(v) || v < min || v > max)
    fail("Valeur numérique invalide.");
  return v;
}
function minutes(t) {
  if (typeof t !== "string" || !/^([01]\d|2[0-3]):[0-5]\d$/.test(t))
    fail("Heure invalide.");
  return Number(t.slice(0, 2)) * 60 + Number(t.slice(3));
}
function daysBetween(start, end) {
  let days = 0;
  for (
    let d = new Date(start + "T12:00:00Z");
    d <= new Date(end + "T12:00:00Z");
    d.setUTCDate(d.getUTCDate() + 1)
  )
    if (![0, 6].includes(d.getUTCDay())) days++;
  return days;
}
function balance(id, year) {
  const u = db.prepare("SELECT allowance FROM users WHERE id=?").get(id);
  const used = db
    .prepare(
      "SELECT COALESCE(SUM(days),0) AS days FROM leaves WHERE user_id=? AND status='approved' AND substr(start,1,4)=?",
    )
    .get(id, year).days;
  return { allowance: u.allowance, used, remaining: u.allowance - used };
}
function admin(u) {
  if (u.role !== "admin") fail("Accès réservé aux administrateurs.", 403);
}
function today() {
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Zurich" }).format(
    new Date(),
  );
}
async function body(req) {
  let data = "";
  for await (const chunk of req) {
    data += chunk;
    if (data.length > 20000) fail("Requête trop volumineuse.", 413);
  }
  try {
    return JSON.parse(data || "{}");
  } catch {
    fail("JSON invalide.");
  }
}
function send(res, status, data) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(JSON.stringify(data));
}
function signIn(res, u) {
  const token = randomBytes(32).toString("hex");
  sessions.set(token, { id: u.id, expires: Date.now() + 86400000 });
  res.setHeader(
    "Set-Cookie",
    `session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=86400${process.env.COOKIE_SECURE === "true" ? "; Secure" : ""}`,
  );
  return safeUser(u);
}
const server = http.createServer(async (req, res) => {
  try {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("Referrer-Policy", "same-origin");
    res.setHeader(
      "Content-Security-Policy",
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
    );
    const url = new URL(req.url, "http://localhost"),
      p = url.pathname,
      method = req.method;
    if (desktop && req.headers.host !== `127.0.0.1:${server.address().port}`)
      fail("Adresse locale non autorisée.", 403);
    if (
      !["GET", "HEAD"].includes(method) &&
      req.headers.origin &&
      new URL(req.headers.origin).host !== req.headers.host
    )
      fail("Origine non autorisée.", 403);
    if (!p.startsWith("/api/")) {
      if (!["GET", "HEAD"].includes(method))
        fail("Méthode non autorisée.", 405);
      const files = {
        "/": "index.html",
        "/app.js": "app.js",
        "/calendar.js": "calendar.js",
        "/style.css": "style.css",
        ...(packaged ? { "/licences.txt": "licenses.txt" } : {}),
      };
      if (!files[p]) fail("Page introuvable.", 404);
      const f = files[p];
      res.writeHead(200, {
        "Cache-Control": "no-cache",
        "Content-Type": f.endsWith(".js")
          ? "text/javascript; charset=utf-8"
          : f.endsWith(".css")
            ? "text/css; charset=utf-8"
            : f.endsWith(".txt")
              ? "text/plain; charset=utf-8"
              : "text/html; charset=utf-8",
      });
      return res.end(
        method === "HEAD"
          ? ""
          : packaged
            ? Buffer.from(getAsset(f))
            : readFileSync(path.join(root, "public", f)),
      );
    }
    if (p === "/api/status" && method === "GET")
      return send(res, 200, {
        setupRequired: !db.prepare("SELECT id FROM users LIMIT 1").get(),
        desktop,
        ...(desktop ? { instanceId } : {}),
      });
    if (p === "/api/setup" && method === "POST") {
      const b = await body(req);
      if (db.prepare("SELECT id FROM users LIMIT 1").get())
        fail("Le compte administrateur existe déjà.", 409);
      const c = credentials(b);
      const r = db
        .prepare(
          "INSERT INTO users(name,email,password,role) VALUES(?,?,?,'admin')",
        )
        .run(c.name, c.email, c.password);
      return send(res, 201, {
        user: signIn(
          res,
          db.prepare("SELECT * FROM users WHERE id=?").get(r.lastInsertRowid),
        ),
      });
    }
    if (p === "/api/login" && method === "POST") {
      const b = await body(req),
        key = req.socket.remoteAddress;
      const a = attempts.get(key) || { count: 0, until: Date.now() + 600000 };
      if (a.until < Date.now()) {
        a.count = 0;
        a.until = Date.now() + 600000;
      }
      if (a.count >= 20)
        fail("Trop de tentatives. Réessayez dans 10 minutes.", 429);
      a.count++;
      attempts.set(key, a);
      if (typeof b.password !== "string" || b.password.length > 128)
        fail("Identifiants incorrects.", 401);
      const u = db
        .prepare("SELECT * FROM users WHERE email=?")
        .get(text(b.email, 200).toLowerCase());
      if (!u || !matches(b.password, u.password))
        fail("Identifiants incorrects.", 401);
      attempts.delete(key);
      return send(res, 200, { user: signIn(res, u) });
    }
    const token = (req.headers.cookie || "")
        .split(";")
        .map((x) => x.trim())
        .find((x) => x.startsWith("session="))
        ?.slice(8),
      s = sessions.get(token);
    if (!s || s.expires < Date.now()) {
      sessions.delete(token);
      fail("Veuillez vous connecter.", 401);
    }
    const u = db.prepare("SELECT * FROM users WHERE id=?").get(s.id);
    if (!u) fail("Veuillez vous connecter.", 401);
    if (p === "/api/desktop/quit" && method === "POST") {
      if (!desktop) fail("Route introuvable.", 404);
      admin(u);
      send(res, 200, { ok: true });
      setTimeout(() => {
        server.close(() => {
          db.close();
          process.exit(0);
        });
        server.closeIdleConnections();
        setTimeout(() => {
          server.closeAllConnections();
        }, 1000).unref();
      }, 150);
      return;
    }
    if (p === "/api/logout" && method === "POST") {
      sessions.delete(token);
      res.setHeader(
        "Set-Cookie",
        "session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0",
      );
      return send(res, 200, { ok: true });
    }
    if (p === "/api/password" && method === "POST") {
      const b = await body(req);
      if (
        typeof b.current_password !== "string" ||
        b.current_password.length > 128 ||
        !matches(b.current_password, u.password)
      )
        fail("Le mot de passe actuel est incorrect.", 400);
      const c = credentials({ ...u, password: b.password });
      db.prepare("UPDATE users SET password=? WHERE id=?").run(
        c.password,
        u.id,
      );
      for (const [k, v] of sessions)
        if (v.id === u.id && k !== token) sessions.delete(k);
      return send(res, 200, { ok: true });
    }
    if (p === "/api/state" && method === "GET") {
      const year = url.searchParams.get("year") || today().slice(0, 4);
      if (!/^\d{4}$/.test(year)) fail("Année invalide.");
      const users = db.prepare("SELECT * FROM users ORDER BY name").all();
      return send(res, 200, {
        desktop,
        user: safeUser(u),
        today: today(),
        users: users.map((x) =>
          u.role === "admin"
            ? { ...safeUser(x), vacation_balance: balance(x.id, year) }
            : { id: x.id, name: x.name },
        ),
        entries: db
          .prepare(
            u.role === "admin"
              ? "SELECT * FROM entries ORDER BY date DESC"
              : "SELECT * FROM entries WHERE user_id=? ORDER BY date DESC",
          )
          .all(...(u.role === "admin" ? [] : [u.id])),
        leaves: db
          .prepare(
            u.role === "admin"
              ? "SELECT * FROM leaves ORDER BY start DESC"
              : "SELECT * FROM leaves WHERE user_id=? ORDER BY start DESC",
          )
          .all(...(u.role === "admin" ? [] : [u.id])),
        balance: balance(u.id, year),
        attendance: users.map((x) => {
          const e = db
            .prepare("SELECT start,end FROM entries WHERE user_id=? AND date=?")
            .get(x.id, today());
          const leave = db
            .prepare(
              "SELECT id FROM leaves WHERE user_id=? AND status='approved' AND start<=? AND end>=?",
            )
            .get(x.id, today(), today());
          return {
            id: x.id,
            name: x.name,
            status: leave ? "leave" : e ? "recorded" : "unknown",
            start: e?.start,
            end: e?.end,
          };
        }),
      });
    }
    if (p === "/api/entries" && method === "POST") {
      const b = await body(req);
      const d = date(b.date),
        start = minutes(b.start),
        end = minutes(b.end),
        pause = number(b.break_minutes, 0, 720);
      if (!Number.isInteger(pause) || end <= start || end - start <= pause)
        fail("La fin doit suivre le début et dépasser la pause.");
      if (d > today()) fail("La saisie des heures futures est interdite.");
      if (
        db
          .prepare(
            "SELECT id FROM leaves WHERE user_id=? AND status='approved' AND start<=? AND end>=?",
          )
          .get(u.id, d, d)
      )
        fail("Cette date correspond à des vacances approuvées.");
      db.prepare(
        "INSERT INTO entries(user_id,date,start,end,break_minutes,note) VALUES(?,?,?,?,?,?) ON CONFLICT(user_id,date) DO UPDATE SET start=excluded.start,end=excluded.end,break_minutes=excluded.break_minutes,note=excluded.note",
      ).run(u.id, d, b.start, b.end, pause, text(b.note || ""));
      return send(res, 200, { ok: true });
    }
    const entryMatch = p.match(/^\/api\/entries\/(\d+)$/);
    if (entryMatch && method === "DELETE") {
      const e = db
        .prepare("SELECT * FROM entries WHERE id=?")
        .get(entryMatch[1]);
      if (!e) fail("Saisie introuvable.", 404);
      if (e.user_id !== u.id)
        fail("Vous ne pouvez supprimer que vos heures.", 403);
      db.prepare("DELETE FROM entries WHERE id=?").run(e.id);
      return send(res, 200, { ok: true });
    }
    if (p === "/api/leaves" && method === "POST") {
      const b = await body(req),
        start = date(b.start),
        end = date(b.end);
      if (end < start || start.slice(0, 4) !== end.slice(0, 4))
        fail("Choisissez une période dans la même année.");
      if (start < today())
        fail("La demande doit commencer aujourd’hui ou plus tard.");
      const days = daysBetween(start, end);
      if (!days) fail("La période doit inclure un jour ouvré.");
      if (
        db
          .prepare(
            "SELECT id FROM leaves WHERE user_id=? AND status!='rejected' AND start<=? AND end>=?",
          )
          .get(u.id, end, start)
      )
        fail("Cette période chevauche une demande existante.");
      const pending = db
        .prepare(
          "SELECT COALESCE(SUM(days),0) AS days FROM leaves WHERE user_id=? AND status='pending' AND substr(start,1,4)=?",
        )
        .get(u.id, start.slice(0, 4)).days;
      if (days > balance(u.id, start.slice(0, 4)).remaining - pending)
        fail("Solde insuffisant, demandes en attente incluses.");
      db.prepare(
        "INSERT INTO leaves(user_id,start,end,days,note) VALUES(?,?,?,?,?)",
      ).run(u.id, start, end, days, text(b.note || ""));
      return send(res, 201, { ok: true });
    }
    const lm = p.match(/^\/api\/leaves\/(\d+)$/);
    if (lm && method === "PATCH") {
      admin(u);
      const b = await body(req);
      if (!["approved", "rejected"].includes(b.status))
        fail("Statut invalide.");
      const l = db.prepare("SELECT * FROM leaves WHERE id=?").get(lm[1]);
      if (!l) fail("Demande introuvable.", 404);
      if (l.status !== "pending")
        fail("Cette demande a déjà été traitée.", 409);
      if (b.status === "approved") {
        if (l.days > balance(l.user_id, l.start.slice(0, 4)).remaining)
          fail("Solde de vacances insuffisant.");
        if (
          db
            .prepare(
              "SELECT id FROM entries WHERE user_id=? AND date BETWEEN ? AND ?",
            )
            .get(l.user_id, l.start, l.end)
        )
          fail(
            "Des heures existent sur cette période. Corrigez-les avant validation.",
          );
      }
      db.prepare("UPDATE leaves SET status=? WHERE id=?").run(b.status, l.id);
      return send(res, 200, { ok: true });
    }
    if (lm && method === "DELETE") {
      const l = db.prepare("SELECT * FROM leaves WHERE id=?").get(lm[1]);
      if (!l) fail("Demande introuvable.", 404);
      if (l.user_id !== u.id || l.status !== "pending")
        fail("Seule votre demande en attente peut être annulée.", 403);
      db.prepare("DELETE FROM leaves WHERE id=?").run(l.id);
      return send(res, 200, { ok: true });
    }
    if (p === "/api/users" && method === "POST") {
      admin(u);
      const b = await body(req),
        c = credentials(b);
      if (!["admin", "user"].includes(b.role)) fail("Rôle invalide.");
      if (db.prepare("SELECT id FROM users WHERE email=?").get(c.email))
        fail("Cette adresse e-mail existe déjà.", 409);
      db.prepare(
        "INSERT INTO users(name,email,password,role,allowance,daily_hours) VALUES(?,?,?,?,?,?)",
      ).run(
        c.name,
        c.email,
        c.password,
        b.role,
        number(b.allowance, 0, 365),
        number(b.daily_hours, 1, 16),
      );
      return send(res, 201, { ok: true });
    }
    const um = p.match(/^\/api\/users\/(\d+)$/);
    if (um && method === "PATCH") {
      admin(u);
      const b = await body(req),
        other = db.prepare("SELECT * FROM users WHERE id=?").get(um[1]);
      if (!other) fail("Utilisateur introuvable.", 404);
      if (!["admin", "user"].includes(b.role)) fail("Rôle invalide.");
      if (other.id === u.id && b.role !== "admin")
        fail("Vous ne pouvez pas retirer votre propre rôle administrateur.");
      const allowance = number(b.allowance, 0, 365);
      const rows = db
        .prepare(
          "SELECT substr(start,1,4) year,SUM(days) days FROM leaves WHERE user_id=? AND status='approved' GROUP BY year",
        )
        .all(other.id);
      if (rows.some((x) => x.days > allowance))
        fail("Le quota ne peut être inférieur aux congés déjà approuvés.");
      db.prepare(
        "UPDATE users SET allowance=?,daily_hours=?,role=? WHERE id=?",
      ).run(allowance, number(b.daily_hours, 1, 16), b.role, other.id);
      if (b.password) {
        const c = credentials({ ...other, password: b.password });
        db.prepare("UPDATE users SET password=? WHERE id=?").run(
          c.password,
          other.id,
        );
        for (const [k, v] of sessions)
          if (v.id === other.id) sessions.delete(k);
      }
      return send(res, 200, { ok: true });
    }
    fail("Route introuvable.", 404);
  } catch (e) {
    if (!e.status) log(e, true);
    send(res, e.status || 500, {
      error: e.status ? e.message : "Erreur interne du serveur.",
    });
  }
});
function openInterface(port) {
  if (
    process.env.TEMPO_NO_OPEN === "true" ||
    process.argv.includes("--no-open")
  )
    return;
  const url = `http://127.0.0.1:${port}`;
  const command =
    process.platform === "win32"
      ? "rundll32.exe"
      : process.platform === "darwin"
        ? "open"
        : "xdg-open";
  const args =
    process.platform === "win32" ? ["url.dll,FileProtocolHandler", url] : [url];
  const child = spawn(command, args, {
    detached: true,
    stdio: "ignore",
    windowsHide: true,
  });
  child.on("error", () =>
    log("Impossible d'ouvrir automatiquement le navigateur.", true),
  );
  child.unref();
}
const port = Number(process.env.PORT || (desktop ? 37129 : 3000));
server.on("error", async (error) => {
  if (desktop && error.code === "EADDRINUSE") {
    try {
      // Contact direct du service local, sans dépendre des paramètres proxy
      // ou de l'initialisation de fetch dans un exécutable graphique.
      const existing = await new Promise((resolve, reject) => {
        const request = http.get(
          `http://127.0.0.1:${port}/api/status`,
          { agent: false, timeout: 3000 },
          (response) => {
            let body = "";
            response.on("data", (chunk) => {
              body += chunk;
              if (body.length > 10000)
                request.destroy(new Error("Réponse locale trop volumineuse."));
            });
            response.on("end", () => {
              try {
                resolve(response.statusCode === 200 ? JSON.parse(body) : null);
              } catch (error) {
                reject(error);
              }
            });
            response.on("error", reject);
          },
        );
        request.on("timeout", () =>
          request.destroy(new Error("Service local indisponible.")),
        );
        request.on("error", reject);
      });
      if (existing?.desktop && existing.instanceId === instanceId) {
        openInterface(port);
        db.close();
        process.exit(0);
      }
    } catch {
      /* Le port appartient à une autre application. */
    }
    server.listen(0, "127.0.0.1");
    return;
  }
  log("Impossible de démarrer Tempo : " + error.code, true);
  db.close();
  process.exit(1);
});
server.on("listening", () => {
  log(`Horaires prêt sur le port ${server.address().port}`);
  if (process.env.TEMPO_READY_FILE)
    writeFileSync(
      process.env.TEMPO_READY_FILE,
      JSON.stringify({ port: server.address().port }),
    );
  if (desktop) openInterface(server.address().port);
});
server.listen(port, desktop ? "127.0.0.1" : process.env.HOST || "0.0.0.0");
