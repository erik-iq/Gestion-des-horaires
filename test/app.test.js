import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const tmp = mkdtempSync(path.join(os.tmpdir(), "tempo-test-"));
let proc, base;
async function launch() {
  proc = spawn(process.execPath, ["server.js"], {
    env: {
      ...process.env,
      BOOTSTRAP_ADMIN_EMAIL: "",
      BOOTSTRAP_ADMIN_PASSWORD: "",
      PORT: "0",
      HOST: "127.0.0.1",
      DB_PATH: path.join(tmp, "test.sqlite"),
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Startup timeout")), 10000);
    proc.once("exit", () => {
      clearTimeout(timer);
      reject(new Error("Server exited"));
    });
    proc.stdout.on("data", (chunk) => {
      const m = String(chunk).match(/port (\d+)/);
      if (m) {
        base = `http://127.0.0.1:${m[1]}`;
        clearTimeout(timer);
        resolve();
      }
    });
  });
}
async function stop() {
  if (proc && !proc.killed) {
    await new Promise((resolve) => {
      proc.once("exit", resolve);
      proc.kill();
    });
  }
}
async function req(url, method = "GET", body, cookie) {
  const r = await fetch(base + url, {
    method,
    headers: {
      ...(body ? { "Content-Type": "application/json" } : {}),
      ...(cookie ? { Cookie: cookie } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  return {
    status: r.status,
    body: await r.json(),
    cookie: r.headers.get("set-cookie")?.split(";")[0],
  };
}
const today = new Intl.DateTimeFormat("sv-SE", {
  timeZone: "Europe/Zurich",
}).format(new Date());
const future = new Date(today + "T12:00:00Z");
future.setUTCDate(future.getUTCDate() + 7);
while ([0, 6].includes(future.getUTCDay()))
  future.setUTCDate(future.getUTCDate() + 1);
let start = future.toISOString().slice(0, 10); // Le solde est vérifié pour l’année de la demande.
const endDate = new Date(future);
endDate.setUTCDate(endDate.getUTCDate() + 4);
while (endDate.getUTCFullYear() !== future.getUTCFullYear())
  endDate.setUTCDate(endDate.getUTCDate() - 1);
const end = endDate.toISOString().slice(0, 10);

test("Parcours complet et isolation des données", async (t) => {
  await launch();
  let admin, user, id, leaveId;
  try {
    await t.test(
      "Le dépôt démarre et présente la création administrateur",
      async () => {
        assert.equal((await fetch(base)).status, 200);
        assert.equal((await req("/api/status")).body.setupRequired, true);
        assert.equal((await req("/api/state")).status, 401);
      },
    );
    await t.test("Création unique du premier administrateur", async () => {
      const r = await req("/api/setup", "POST", {
        name: "Admin Test",
        email: "admin@example.ch",
        password: "Test-password-123",
      });
      assert.equal(r.status, 201);
      assert.equal(r.body.user.role, "admin");
      assert.ok(!("password" in r.body.user));
      admin = r.cookie;
      assert.equal(
        (
          await req("/api/setup", "POST", {
            name: "Other",
            email: "other@example.ch",
            password: "Test-password-123",
          })
        ).status,
        409,
      );
    });
    await t.test("Création du collaborateur et authentification", async () => {
      assert.equal(
        (
          await req(
            "/api/users",
            "POST",
            {
              name: "Alice Martin",
              email: "alice@example.ch",
              password: "Test-password-456",
              role: "user",
              allowance: 25,
              daily_hours: 8,
            },
            admin,
          )
        ).status,
        201,
      );
      assert.equal(
        (
          await req("/api/login", "POST", {
            email: "alice@example.ch",
            password: "wrong",
          })
        ).status,
        401,
      );
      const r = await req("/api/login", "POST", {
        email: "alice@example.ch",
        password: "Test-password-456",
      });
      assert.equal(r.status, 200);
      user = r.cookie;
      id = r.body.user.id;
    });
    await t.test("Saisie, correction et calcul des horaires", async () => {
      const payload = {
        date: today,
        start: "08:00",
        end: "17:00",
        break_minutes: 60,
        note: "Projet client",
      };
      assert.equal(
        (await req("/api/entries", "POST", payload, user)).status,
        200,
      );
      assert.equal(
        (await req("/api/entries", "POST", { ...payload, end: "07:00" }, user))
          .status,
        400,
      );
      assert.equal(
        (await req("/api/entries", "POST", { ...payload, end: "17:30" }, user))
          .status,
        200,
      );
      const s = (await req("/api/state", "GET", null, user)).body;
      assert.equal(s.entries.length, 1);
      assert.equal(s.entries[0].end, "17:30");
      assert.equal(s.attendance.find((x) => x.id === id).status, "recorded");
    });
    await t.test(
      "Les comptes utilisateur ne voient pas les données des autres",
      async () => {
        assert.equal(
          (
            await req(
              "/api/entries",
              "POST",
              {
                date: today,
                start: "09:00",
                end: "12:00",
                break_minutes: 0,
                note: "Privé",
              },
              admin,
            )
          ).status,
          200,
        );
        const s = (await req("/api/state", "GET", null, user)).body;
        assert.equal(s.entries.length, 1);
        assert.ok(s.entries.every((x) => x.user_id === id));
        assert.ok(s.users.every((x) => !("email" in x) && !("allowance" in x)));
        assert.equal((await req("/api/users", "POST", {}, user)).status, 403);
        const a = (await req("/api/state", "GET", null, admin)).body;
        assert.equal(a.entries.length, 2);
        assert.equal(
          (
            await req(
              "/api/entries/" + a.entries.find((x) => x.user_id !== id).id,
              "DELETE",
              null,
              user,
            )
          ).status,
          403,
        );
      },
    );
    await t.test(
      "La demande de congés doit être valide et ne pas se chevaucher",
      async () => {
        assert.equal(
          (
            await req(
              "/api/leaves",
              "POST",
              { start, end, note: "Vacances" },
              user,
            )
          ).status,
          201,
        );
        assert.equal(
          (await req("/api/leaves", "POST", { start, end, note: "" }, user))
            .status,
          400,
        );
        assert.equal(
          (
            await req(
              "/api/leaves",
              "POST",
              { start: "2026-02-30", end: "2026-03-02" },
              user,
            )
          ).status,
          400,
        );
        const s = (await req("/api/state", "GET", null, user)).body;
        leaveId = s.leaves[0].id;
        assert.equal(s.leaves[0].status, "pending");
        assert.ok(s.leaves[0].days >= 1 && s.leaves[0].days <= 5);
      },
    );
    await t.test(
      "Seul un administrateur valide les congés et le solde se met à jour",
      async () => {
        assert.equal(
          (
            await req(
              "/api/leaves/" + leaveId,
              "PATCH",
              { status: "approved" },
              user,
            )
          ).status,
          403,
        );
        assert.equal(
          (
            await req(
              "/api/leaves/" + leaveId,
              "PATCH",
              { status: "approved" },
              admin,
            )
          ).status,
          200,
        );
        const s = (
          await req("/api/state?year=" + start.slice(0, 4), "GET", null, user)
        ).body;
        assert.equal(s.balance.used, s.leaves[0].days);
        assert.equal(s.balance.remaining, 25 - s.leaves[0].days);
        assert.equal(
          (
            await req(
              "/api/leaves/" + leaveId,
              "PATCH",
              { status: "rejected" },
              admin,
            )
          ).status,
          409,
        );
        assert.equal(
          (await req("/api/leaves/" + leaveId, "DELETE", null, user)).status,
          403,
        );
      },
    );
    await t.test(
      "Gestion des quotas et protection de son rôle administrateur",
      async () => {
        const s = (await req("/api/state", "GET", null, admin)).body;
        assert.equal(
          (
            await req(
              "/api/users/" + s.user.id,
              "PATCH",
              { role: "user", allowance: 25, daily_hours: 8 },
              admin,
            )
          ).status,
          400,
        );
        assert.equal(
          (
            await req(
              "/api/users/" + id,
              "PATCH",
              { role: "user", allowance: 0, daily_hours: 8 },
              admin,
            )
          ).status,
          400,
        );
        assert.equal(
          (
            await req(
              "/api/users/" + id,
              "PATCH",
              { role: "user", allowance: 30, daily_hours: 7.5 },
              admin,
            )
          ).status,
          200,
        );
      },
    );
    await t.test(
      "Protection des requêtes provenant d’un autre site",
      async () => {
        const r = await fetch(base + "/api/entries", {
          method: "POST",
          headers: {
            Cookie: user,
            Origin: "https://evil.example",
            "Content-Type": "application/json",
          },
          body: "{}",
        });
        assert.equal(r.status, 403);
      },
    );
    await t.test(
      "Les données persistent et les sessions expirent au redémarrage",
      async () => {
        await stop();
        await launch();
        assert.equal((await req("/api/status")).body.setupRequired, false);
        assert.equal((await req("/api/state", "GET", null, user)).status, 401);
        const r = await req("/api/login", "POST", {
          email: "alice@example.ch",
          password: "Test-password-456",
        });
        assert.equal(r.status, 200);
        user = r.cookie;
        const s = (await req("/api/state", "GET", null, user)).body;
        assert.equal(s.entries.length, 1);
        assert.equal(s.leaves[0].status, "approved");
        assert.equal(s.user.allowance, 30);
      },
    );
    await t.test(
      "Changement de mot de passe avec vérification et invalidation des autres sessions",
      async () => {
        const second = (
          await req("/api/login", "POST", {
            email: "alice@example.ch",
            password: "Test-password-456",
          })
        ).cookie;
        assert.equal(
          (
            await req(
              "/api/password",
              "POST",
              { current_password: "wrong", password: "New-password-789" },
              user,
            )
          ).status,
          400,
        );
        assert.equal(
          (
            await req(
              "/api/password",
              "POST",
              {
                current_password: "Test-password-456",
                password: "New-password-789",
              },
              user,
            )
          ).status,
          200,
        );
        assert.equal(
          (await req("/api/state", "GET", null, second)).status,
          401,
        );
        assert.equal((await req("/api/state", "GET", null, user)).status, 200);
        assert.equal(
          (
            await req("/api/login", "POST", {
              email: "alice@example.ch",
              password: "Test-password-456",
            })
          ).status,
          401,
        );
        assert.equal(
          (
            await req("/api/login", "POST", {
              email: "alice@example.ch",
              password: "New-password-789",
            })
          ).status,
          200,
        );
      },
    );
    await t.test("La déconnexion invalide la session", async () => {
      assert.equal((await req("/api/logout", "POST", {}, user)).status, 200);
      assert.equal((await req("/api/state", "GET", null, user)).status, 401);
    });
  } finally {
    await stop();
    rmSync(tmp, { recursive: true, force: true });
  }
});
