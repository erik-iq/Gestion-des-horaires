import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import path from "node:path";
import os from "node:os";
import http from "node:http";

const executable = process.env.TEMPO_TEST_EXECUTABLE || process.execPath;
function launch(dbPath, port = "0") {
  const readyFile = path.join(
    path.dirname(dbPath),
    "ready-" + randomUUID() + ".json",
  );
  const child = spawn(
    executable,
    process.env.TEMPO_TEST_EXECUTABLE ? ["--no-open"] : ["server.js"],
    {
      env: {
        ...process.env,
        DB_PATH: dbPath,
        TEMPO_READY_FILE: readyFile,
        PORT: String(port),
        TEMPO_DESKTOP: "true",
        TEMPO_NO_OPEN: "true",
        BOOTSTRAP_ADMIN_EMAIL: "",
        BOOTSTRAP_ADMIN_PASSWORD: "",
        COOKIE_SECURE: "false",
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  let stderr = "";
  child.stderr.on("data", (chunk) => {
    stderr += chunk;
  });
  const ready = new Promise((resolve, reject) => {
    const polling = setInterval(() => {
      try {
        const ready = JSON.parse(readFileSync(readyFile, "utf8"));
        clearInterval(polling);
        clearTimeout(timer);
        resolve({ base: "http://127.0.0.1:" + ready.port, port: ready.port });
      } catch {
        /* L'application graphique n'écrit pas dans une console. */
      }
    }, 50);
    const timer = setTimeout(() => {
      clearInterval(polling);
      child.kill();
      reject(new Error("Startup timeout: " + stderr));
    }, 10000);
    child.once("exit", (code) => {
      clearTimeout(timer);
      clearInterval(polling);
      resolve({ exit: code });
    });
    child.stdout.on("data", (chunk) => {
      const match = String(chunk).match(/port (\d+)/);
      if (match) {
        clearTimeout(timer);
        clearInterval(polling);
        resolve({ base: "http://127.0.0.1:" + match[1], port: match[1] });
      }
    });
  });
  return { child, ready };
}
async function request(base, route, method = "GET", data, cookie) {
  const r = await fetch(base + route, {
    method,
    headers: {
      ...(data ? { "Content-Type": "application/json" } : {}),
      ...(cookie ? { Cookie: cookie } : {}),
    },
    body: data ? JSON.stringify(data) : undefined,
  });
  return {
    r,
    data: await r.json(),
    cookie: r.headers.get("set-cookie")?.split(";")[0],
  };
}
test("Application portable : ressources, isolation locale, instance unique et fermeture", async (t) => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "tempo-desktop-"));
  const app = launch(path.join(dir, "horaires.sqlite"));
  try {
    const { base, port } = await app.ready;
    assert.ok(base);
    let admin;
    await t.test(
      "Les ressources intégrées et la connexion locale fonctionnent",
      async () => {
        for (const asset of [
          "/",
          "/app.js",
          "/calendar.js",
          "/metrics.js",
          "/theme.js",
          "/style.css",
        ]) {
          const r = await fetch(base + asset);
          assert.equal(r.status, 200);
          assert.ok((await r.text()).length > 100);
        }
        const status = await request(base, "/api/status");
        assert.equal(status.data.desktop, true);
        assert.equal(status.data.setupRequired, true);
        assert.match(status.data.instanceId, /^[a-f0-9]{64}$/);
        const hostileStatus = await new Promise((resolve, reject) => {
          http
            .get(
              base + "/api/status",
              { headers: { Host: "evil.example" } },
              (response) => {
                response.resume();
                resolve(response.statusCode);
              },
            )
            .on("error", reject);
        });
        assert.equal(hostileStatus, 403);
        assert.equal(
          (await request(base, "/api/desktop/quit", "POST", {})).r.status,
          401,
        );
      },
    );
    await t.test(
      "Un second lancement réutilise la même application",
      async () => {
        const second = launch(path.join(dir, "horaires.sqlite"), port);
        try {
          const result = await second.ready;
          const diagnostics = result.base
            ? {
                result,
                initial: (await request(base, "/api/status")).data,
                duplicate: (await request(result.base, "/api/status")).data,
              }
            : result;
          assert.equal(result.exit, 0, JSON.stringify(diagnostics));
          assert.equal((await request(base, "/api/status")).r.status, 200);
        } finally {
          if (second.child.exitCode === null) second.child.kill();
        }
      },
    );
    await t.test(
      "Les heures sont enregistrées dans la base locale",
      async () => {
        const created = await request(base, "/api/setup", "POST", {
          name: "Admin Portable",
          email: "portable@example.ch",
          password: "Portable-Test-123",
        });
        assert.equal(created.r.status, 201);
        admin = created.cookie;
        const today = new Intl.DateTimeFormat("sv-SE", {
          timeZone: "Europe/Zurich",
        }).format(new Date());
        assert.equal(
          (
            await request(
              base,
              "/api/entries",
              "POST",
              {
                date: today,
                start: "08:00",
                end: "17:00",
                break_minutes: 60,
                note: "Test portable",
              },
              admin,
            )
          ).r.status,
          200,
        );
        const state = await request(base, "/api/state", "GET", null, admin);
        assert.equal(state.data.desktop, true);
        assert.equal(state.data.entries[0].note, "Test portable");
      },
    );
    await t.test(
      "Le PDF utilise le logo et la police de l’application portable",
      async () => {
        const state = await request(base, "/api/state", "GET", null, admin);
        const response = await fetch(
          base + "/api/report/pdf?month=" + state.data.today.slice(0, 7),
          { headers: { Cookie: admin } },
        );
        assert.equal(response.status, 200);
        assert.equal(response.headers.get("content-type"), "application/pdf");
        const bytes = Buffer.from(await response.arrayBuffer());
        assert.equal(bytes.subarray(0, 5).toString(), "%PDF-");
        assert.ok(bytes.length > 20000);
      },
    );
    await t.test(
      "Seul un administrateur peut fermer l’application",
      async () => {
        await request(
          base,
          "/api/users",
          "POST",
          {
            name: "Portable User",
            email: "user@example.ch",
            password: "Portable-User-123",
            role: "user",
            allowance: 25,
            daily_hours: 8,
          },
          admin,
        );
        const login = await request(base, "/api/login", "POST", {
          email: "user@example.ch",
          password: "Portable-User-123",
        });
        assert.equal(
          (
            await request(
              base,
              "/api/clock",
              "POST",
              { action: "start" },
              login.cookie,
            )
          ).r.status,
          200,
        );
        assert.equal(
          (
            await request(
              base,
              "/api/clock",
              "POST",
              { action: "pause" },
              login.cookie,
            )
          ).r.status,
          200,
        );
        const workerState = await request(
          base,
          "/api/state",
          "GET",
          null,
          login.cookie,
        );
        assert.ok(workerState.data.clock.paused_at);
        const today = workerState.data.today;
        assert.equal(
          (
            await request(
              base,
              "/api/entries",
              "POST",
              { date: today, start: "08:00", end: "17:00", break_minutes: 60 },
              login.cookie,
            )
          ).r.status,
          409,
        );
        const batch = await request(
          base,
          "/api/entries/batch",
          "POST",
          {
            entries: [
              { date: today, start: "08:00", end: "17:00", break_minutes: 60 },
            ],
            replace_existing: true,
          },
          login.cookie,
        );
        assert.equal(batch.data.applied.length, 0);
        assert.equal(batch.data.skipped[0].reason, "Pointage en cours");
        assert.equal(
          (await request(base, "/api/desktop/quit", "POST", {}, login.cookie)).r
            .status,
          403,
        );
        const exited = new Promise((resolve) =>
          app.child.once("exit", resolve),
        );
        assert.equal(
          (await request(base, "/api/desktop/quit", "POST", {}, admin)).r
            .status,
          200,
        );
        assert.equal(await exited, 0);
      },
    );
    await t.test(
      "Les comptes et les heures restent disponibles après réouverture",
      async () => {
        const reopened = launch(path.join(dir, "horaires.sqlite"));
        const state = await reopened.ready;
        try {
          const login = await request(state.base, "/api/login", "POST", {
            email: "portable@example.ch",
            password: "Portable-Test-123",
          });
          assert.equal(login.r.status, 200);
          const data = await request(
            state.base,
            "/api/state",
            "GET",
            null,
            login.cookie,
          );
          assert.equal(data.data.entries.length, 1);
          assert.equal(data.data.clock, null);
          const worker = await request(state.base, "/api/login", "POST", {
            email: "user@example.ch",
            password: "Portable-User-123",
          });
          const workerState = await request(
            state.base,
            "/api/state",
            "GET",
            null,
            worker.cookie,
          );
          assert.ok(workerState.data.clock.paused_at);
          assert.equal(
            (
              await request(
                state.base,
                "/api/clock",
                "POST",
                { action: "cancel" },
                worker.cookie,
              )
            ).r.status,
            200,
          );
          const exited = new Promise((resolve) =>
            reopened.child.once("exit", resolve),
          );
          await request(
            state.base,
            "/api/desktop/quit",
            "POST",
            {},
            login.cookie,
          );
          assert.equal(await exited, 0);
        } finally {
          if (reopened.child.exitCode === null) reopened.child.kill();
        }
      },
    );
  } finally {
    if (app.child.exitCode === null) app.child.kill();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("Mise à jour : une base de la première version conserve ses comptes et ses horaires", async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "tempo-upgrade-"));
  const dbPath = path.join(dir, "horaires.sqlite");
  const { DatabaseSync } = await import("node:sqlite");
  const { scryptSync } = await import("node:crypto");
  const legacy = new DatabaseSync(dbPath);
  legacy.exec(`CREATE TABLE users(id INTEGER PRIMARY KEY,name TEXT NOT NULL,email TEXT NOT NULL UNIQUE,password TEXT NOT NULL,role TEXT NOT NULL,allowance REAL NOT NULL DEFAULT 25,daily_hours REAL NOT NULL DEFAULT 8);
CREATE TABLE entries(id INTEGER PRIMARY KEY,user_id INTEGER NOT NULL REFERENCES users(id),date TEXT NOT NULL,start TEXT NOT NULL,end TEXT NOT NULL,break_minutes INTEGER NOT NULL,note TEXT NOT NULL DEFAULT '',UNIQUE(user_id,date));
CREATE TABLE leaves(id INTEGER PRIMARY KEY,user_id INTEGER NOT NULL REFERENCES users(id),start TEXT NOT NULL,end TEXT NOT NULL,days INTEGER NOT NULL,status TEXT NOT NULL DEFAULT 'pending',note TEXT NOT NULL DEFAULT '');`);
  const salt = "0123456789abcdef0123456789abcdef";
  const hash =
    salt + ":" + scryptSync("Legacy-Test-123", salt, 64).toString("hex");
  legacy
    .prepare("INSERT INTO users VALUES(1,?,?,?,'admin',25,8)")
    .run("Compte existant", "legacy@example.ch", hash);
  const today = new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Europe/Zurich",
  }).format(new Date());
  legacy
    .prepare("INSERT INTO entries VALUES(1,1,?,?,?,?,?)")
    .run(
      today,
      "08:00",
      "17:00",
      60,
      "Donnée enregistrée avant la mise à jour",
    );
  legacy.close();
  const app = launch(dbPath);
  try {
    const { base } = await app.ready;
    assert.equal(
      (await request(base, "/api/status")).data.setupRequired,
      false,
    );
    const login = await request(base, "/api/login", "POST", {
      email: "legacy@example.ch",
      password: "Legacy-Test-123",
    });
    assert.equal(login.r.status, 200);
    const state = await request(base, "/api/state", "GET", null, login.cookie);
    assert.equal(state.data.user.name, "Compte existant");
    assert.equal(state.data.user.allowance, 25);
    assert.equal(state.data.entries.length, 1);
    assert.equal(
      state.data.entries[0].note,
      "Donnée enregistrée avant la mise à jour",
    );
    const exited = new Promise((resolve) => app.child.once("exit", resolve));
    await request(base, "/api/desktop/quit", "POST", {}, login.cookie);
    assert.equal(await exited, 0);
    const persisted = new DatabaseSync(dbPath);
    assert.equal(
      persisted.prepare("SELECT COUNT(*) AS count FROM users").get().count,
      1,
    );
    assert.equal(
      persisted
        .prepare(
          "SELECT COUNT(*) AS count FROM sqlite_master WHERE type=? AND name LIKE ?",
        )
        .get("index", "idx_%").count,
      3,
    );
    persisted.close();
  } finally {
    if (app.child.exitCode === null) app.child.kill();
    rmSync(dir, { recursive: true, force: true });
  }
});
