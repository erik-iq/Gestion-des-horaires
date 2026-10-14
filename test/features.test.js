import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { PDFDocument } from "pdf-lib";
test("Fonctions avancées : contrats, saisie rapide, verrouillage, confidentialité et PDF", async (t) => {
  const tmp = mkdtempSync(path.join(os.tmpdir(), "tempo-features-"));
  const child = spawn(process.execPath, ["server.js"], {
    env: {
      ...process.env,
      PORT: "0",
      HOST: "127.0.0.1",
      DB_PATH: path.join(tmp, "data.sqlite"),
      BOOTSTRAP_ADMIN_EMAIL: "",
      BOOTSTRAP_ADMIN_PASSWORD: "",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const base = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Startup timeout")), 10000);
    child.once("exit", () => reject(new Error("Server exited")));
    child.stdout.on("data", (b) => {
      const match = String(b).match(/port (\d+)/);
      if (match) {
        clearTimeout(timer);
        resolve("http://127.0.0.1:" + match[1]);
      }
    });
  });
  let admin, user, userId;
  const request = async (p, method = "GET", body, cookie = admin) => {
    const r = await fetch(base + p, {
      method,
      headers: {
        ...(body ? { "Content-Type": "application/json" } : {}),
        ...(cookie ? { Cookie: cookie } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    return {
      r,
      data: await r.json(),
      cookie: r.headers.get("set-cookie")?.split(";")[0],
    };
  };
  try {
    await t.test("Créer deux comptes et configurer le contrat", async () => {
      admin = (
        await request("/api/setup", "POST", {
          name: "Direction",
          email: "boss.features@example.ch",
          password: "Features-Test-123",
        })
      ).cookie;
      await request("/api/users", "POST", {
        name: "Employé",
        email: "worker.features@example.ch",
        password: "Features-Test-456",
        role: "user",
        allowance: 25,
        daily_hours: 8,
      });
      const login = await request("/api/login", "POST", {
        email: "worker.features@example.ch",
        password: "Features-Test-456",
      });
      user = login.cookie;
      userId = login.data.user.id;
      assert.equal(
        (
          await request("/api/contracts/" + userId, "POST", {
            effective_from: "2026-09-01",
            schedule: [480, 480, 240, 480, 480, 0, 0],
            opening_hours: 2,
          })
        ).r.status,
        200,
      );
      assert.equal(
        (
          await request(
            "/api/contracts/" + userId,
            "POST",
            { effective_from: "2026-09-01", schedule: [480], opening_hours: 0 },
            user,
          )
        ).r.status,
        403,
      );
    });
    await t.test(
      "La saisie groupée valide tout avant de modifier les données",
      async () => {
        const entries = [
          {
            date: "2026-09-14",
            start: "08:00",
            end: "17:00",
            break_minutes: 60,
            note: "Privé au collaborateur",
          },
          {
            date: "2026-09-15",
            start: "08:00",
            end: "17:00",
            break_minutes: 60,
          },
        ];
        const result = await request(
          "/api/entries/batch",
          "POST",
          { entries },
          user,
        );
        assert.equal(result.data.applied.length, 2);
        const duplicate = await request(
          "/api/entries/batch",
          "POST",
          { entries },
          user,
        );
        assert.equal(duplicate.data.skipped.length, 2);
        const invalid = await request(
          "/api/entries/batch",
          "POST",
          {
            entries: [
              { ...entries[0], date: "2026-09-16" },
              { ...entries[1], date: "2026-09-17", end: "07:00" },
            ],
          },
          user,
        );
        assert.equal(invalid.r.status, 400);
        assert.equal(
          (await request("/api/state", "GET", null, user)).data.entries.length,
          2,
        );
      },
    );
    await t.test("Favoris et semaines types restent privés", async () => {
      assert.equal(
        (
          await request(
            "/api/favorites",
            "POST",
            {
              name: "Standard",
              start: "08:00",
              end: "17:00",
              break_minutes: 60,
            },
            user,
          )
        ).r.status,
        201,
      );
      assert.equal(
        (
          await request(
            "/api/week-templates",
            "POST",
            {
              name: "Habituelle",
              pattern: [
                { weekday: 1, start: "08:00", end: "17:00", break_minutes: 60 },
              ],
            },
            user,
          )
        ).r.status,
        201,
      );
      const own = (await request("/api/state", "GET", null, user)).data;
      assert.equal(own.favorites.length, 1);
      assert.equal(own.week_templates.length, 1);
      assert.equal((await request("/api/state")).data.favorites.length, 0);
      assert.equal(
        (await request("/api/favorites/" + own.favorites[0].id, "DELETE")).r
          .status,
        404,
      );
    });
    await t.test(
      "La semaine d’équipe expose les horaires, pas les notes ni les contrats",
      async () => {
        const result = await request(
          "/api/team-week?start=2026-09-14",
          "GET",
          null,
          user,
        );
        assert.equal(result.r.status, 200);
        assert.equal(result.data.entries.length, 2);
        assert.ok(result.data.entries.every((e) => !("note" in e)));
        assert.ok(
          result.data.users.every((u) => !("email" in u) && !("password" in u)),
        );
      },
    );
    await t.test(
      "La validation est administrateur et verrouille les créations, corrections, suppressions et contrats rétroactifs",
      async () => {
        assert.equal(
          (
            await request(
              "/api/validations/" + userId + "/2026-09",
              "POST",
              {},
              user,
            )
          ).r.status,
          403,
        );
        assert.equal(
          (await request("/api/validations/" + userId + "/2026-09", "POST", {}))
            .r.status,
          200,
        );
        const state = (await request("/api/state", "GET", null, user)).data;
        assert.equal(state.locks.length, 1);
        assert.equal(
          (
            await request(
              "/api/entries",
              "POST",
              {
                date: "2026-09-14",
                start: "08:00",
                end: "18:00",
                break_minutes: 60,
              },
              user,
            )
          ).r.status,
          409,
        );
        assert.equal(
          (
            await request(
              "/api/entries/" + state.entries[0].id,
              "DELETE",
              null,
              user,
            )
          ).r.status,
          409,
        );
        assert.equal(
          (
            await request("/api/contracts/" + userId, "POST", {
              effective_from: "2026-09-20",
              schedule: [480, 480, 480, 480, 480, 0, 0],
              opening_hours: 0,
            })
          ).r.status,
          409,
        );
        const batch = await request(
          "/api/entries/batch",
          "POST",
          {
            replace_existing: true,
            entries: [
              {
                date: "2026-09-14",
                start: "08:00",
                end: "18:00",
                break_minutes: 60,
              },
            ],
          },
          user,
        );
        assert.equal(batch.data.applied.length, 0);
        assert.equal(batch.data.skipped[0].reason, "Mois verrouillé");
      },
    );
    await t.test(
      "Le PDF est réel, contient des pages et ne peut pas être téléchargé pour autrui",
      async () => {
        const r = await fetch(
          base + "/api/report/pdf?month=2026-09&user=" + userId,
          { headers: { Cookie: user } },
        );
        assert.equal(r.status, 200);
        assert.equal(r.headers.get("content-type"), "application/pdf");
        const bytes = new Uint8Array(await r.arrayBuffer());
        assert.ok(bytes.length > 10000);
        assert.equal((await PDFDocument.load(bytes)).getPageCount(), 1);
        assert.equal(
          (
            await fetch(base + "/api/report/pdf?month=2026-09&user=1", {
              headers: { Cookie: user },
            })
          ).status,
          403,
        );
      },
    );
    await t.test(
      "L’historique exclut les mots de passe et se limite au collaborateur",
      async () => {
        await request("/api/password", "POST", {
          current_password: "Features-Test-123",
          password: "Features-New-Password-123",
        });
        const history = (await request("/api/history", "GET", null, user)).data;
        assert.ok(history.items.length >= 4);
        assert.ok(history.items.every((i) => i.subject_user_id === userId));
        assert.ok(!JSON.stringify(history).includes("Features-Test"));
        assert.ok(
          !JSON.stringify((await request("/api/history")).data).includes(
            "Features-New-Password",
          ),
        );
      },
    );
    await t.test(
      "Réouvrir exige un motif et restaure les droits de saisie",
      async () => {
        assert.equal(
          (
            await request("/api/validations/" + userId + "/2026-09", "DELETE", {
              reason: "",
            })
          ).r.status,
          400,
        );
        assert.equal(
          (
            await request("/api/validations/" + userId + "/2026-09", "DELETE", {
              reason: "Correction demandée",
            })
          ).r.status,
          200,
        );
        assert.equal(
          (
            await request(
              "/api/entries",
              "POST",
              {
                date: "2026-09-14",
                start: "08:00",
                end: "18:00",
                break_minutes: 60,
              },
              user,
            )
          ).r.status,
          200,
        );
        const history = (await request("/api/history", "GET", null, user)).data;
        assert.ok(history.items.some((i) => i.action === "month.reopen"));
      },
    );
  } finally {
    await new Promise((resolve) => {
      child.once("exit", resolve);
      child.kill();
    });
    rmSync(tmp, { recursive: true, force: true });
  }
});
