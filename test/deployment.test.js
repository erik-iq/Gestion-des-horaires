import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import path from "node:path";
import os from "node:os";

async function startServer(dbPath, extra) {
  const processHandle = spawn(process.execPath, ["server.js"], {
    env: {
      ...process.env,
      BOOTSTRAP_ADMIN_EMAIL: "",
      BOOTSTRAP_ADMIN_PASSWORD: "",
      PORT: "0",
      HOST: "127.0.0.1",
      DB_PATH: dbPath,
      ...extra,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  processHandle.stderr.on("data", (chunk) => {
    output += chunk;
  });
  const base = await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      processHandle.kill();
      reject(new Error("Startup timeout"));
    }, 10000);
    processHandle.once("exit", () => {
      clearTimeout(timeout);
      reject(new Error("Server startup failed: " + output));
    });
    processHandle.stdout.on("data", (chunk) => {
      const match = String(chunk).match(/port (\d+)/);
      if (match) {
        clearTimeout(timeout);
        resolve("http://127.0.0.1:" + match[1]);
      }
    });
  });
  return {
    base,
    stop: () =>
      new Promise((resolve) => {
        processHandle.once("exit", resolve);
        processHandle.kill();
      }),
  };
}
async function post(base, route, data) {
  const r = await fetch(base + route, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  return { response: r, body: await r.json() };
}

test("Déploiement : administrateur initial, cookies HTTPS et redémarrage", async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "tempo-deployment-"));
  const dbPath = path.join(dir, "persistent", "horaires.sqlite");
  let server;
  try {
    server = await startServer(dbPath, {
      BOOTSTRAP_ADMIN_EMAIL: "owner@example.ch",
      BOOTSTRAP_ADMIN_PASSWORD: "Deployment-Test-123",
      COOKIE_SECURE: "true",
    });
    assert.equal(
      (await (await fetch(server.base + "/api/status")).json()).setupRequired,
      false,
    );
    const login = await post(server.base, "/api/login", {
      email: "owner@example.ch",
      password: "Deployment-Test-123",
    });
    assert.equal(login.response.status, 200);
    assert.equal(login.body.user.role, "admin");
    assert.match(login.response.headers.get("set-cookie"), /; Secure/);
    assert.match(login.response.headers.get("set-cookie"), /; HttpOnly/);
    const setup = await post(server.base, "/api/setup", {
      name: "Someone else",
      email: "other@example.ch",
      password: "Other-Password-123",
    });
    assert.equal(setup.response.status, 409);
    await server.stop();
    server = null;
    server = await startServer(dbPath, {
      BOOTSTRAP_ADMIN_EMAIL: "other@example.ch",
      BOOTSTRAP_ADMIN_PASSWORD: "Other-Password-123",
    });
    assert.equal(
      (
        await post(server.base, "/api/login", {
          email: "owner@example.ch",
          password: "Deployment-Test-123",
        })
      ).response.status,
      200,
    );
    assert.equal(
      (
        await post(server.base, "/api/login", {
          email: "other@example.ch",
          password: "Other-Password-123",
        })
      ).response.status,
      401,
    );
  } finally {
    if (server) await server.stop();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("Déploiement : un compte initial incomplet empêche l’ouverture du serveur", async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "tempo-invalid-deployment-"));
  try {
    await assert.rejects(
      startServer(path.join(dir, "horaires.sqlite"), {
        BOOTSTRAP_ADMIN_EMAIL: "owner@example.ch",
      }),
      /Création administrateur impossible/,
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
