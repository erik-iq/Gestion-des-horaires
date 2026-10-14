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
        for (const asset of ["/", "/app.js", "/style.css"]) {
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
