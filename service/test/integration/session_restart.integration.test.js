import { test } from "node:test";
import assert from "node:assert/strict";
import { rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createServer } from "../../src/server.js";
import { isIntegrationEnabled } from "../../test_support/integration_harness.js";

const INTEGRATION_ENABLED = isIntegrationEnabled();
const integrationTest = INTEGRATION_ENABLED ? test : test.skip;

integrationTest("session survives full server restart via sqlite", async () => {
  const dbPath = path.join(os.tmpdir(), `cataloguesearch-chat-restart-${process.pid}-${Date.now()}.db`);

  await cleanupDbFiles(dbPath);

  let first = null;
  let second = null;
  try {
    first = createServer({
      testMode: true,
      cleanSessionDb: false,
      sessionDbPath: dbPath,
      port: 0,
      host: "127.0.0.1",
    });
    await first.start({ port: 0, host: "127.0.0.1" });
    const firstBaseUrl = first.getBaseUrl();
    assert.ok(firstBaseUrl);

    const created = await post(firstBaseUrl, "/v1/chat/sessions", { provider: "auto" });
    assert.equal(created.res.status, 200);
    const sessionId = created.json.session_id;

    const initialMessage = await post(firstBaseUrl, `/v1/chat/sessions/${sessionId}/messages`, {
      role: "user",
      content: "initial restart test question",
    });
    assert.equal(initialMessage.res.status, 200);

    const beforeRestart = await get(firstBaseUrl, `/v1/chat/sessions/${sessionId}`);
    assert.equal(beforeRestart.res.status, 200);
    assert.equal(beforeRestart.json.messages.length, 2);

    await first.stop();

    second = createServer({
      testMode: true,
      cleanSessionDb: false,
      sessionDbPath: dbPath,
      port: 0,
      host: "127.0.0.1",
    });
    await second.start({ port: 0, host: "127.0.0.1" });
    const secondBaseUrl = second.getBaseUrl();
    assert.ok(secondBaseUrl);

    const restored = await get(secondBaseUrl, `/v1/chat/sessions/${sessionId}`);
    assert.equal(restored.res.status, 200);
    assert.equal(restored.json.messages.length, 2);

    const followup = await post(secondBaseUrl, `/v1/chat/sessions/${sessionId}/messages`, {
      role: "user",
      content: "followup after restart",
    });
    assert.equal(followup.res.status, 200);

    const afterRestart = await get(secondBaseUrl, `/v1/chat/sessions/${sessionId}`);
    assert.equal(afterRestart.res.status, 200);
    assert.equal(afterRestart.json.messages.length, 4);
  } finally {
    await first?.stop?.();
    await second?.stop?.();
    await cleanupDbFiles(dbPath);
  }
});

integrationTest("session with user_id survives restart and is listable before and after", async () => {
  const dbPath = path.join(os.tmpdir(), `cataloguesearch-chat-restart-userid-${process.pid}-${Date.now()}.db`);
  await cleanupDbFiles(dbPath);

  let first = null;
  let second = null;
  try {
    first = createServer({ testMode: true, cleanSessionDb: false, sessionDbPath: dbPath, port: 0, host: "127.0.0.1" });
    await first.start({ port: 0, host: "127.0.0.1" });
    const firstBase = first.getBaseUrl();

    const created = await post(firstBase, "/v1/chat/sessions", { provider: "auto", user_id: "browser-restart-user" });
    assert.equal(created.res.status, 200);
    const sessionId = created.json.session_id;

    const msg = await post(firstBase, `/v1/chat/sessions/${sessionId}/messages`, { role: "user", content: "question before restart" });
    assert.equal(msg.res.status, 200);

    const listedBefore = await get(firstBase, "/v1/users/browser-restart-user/sessions");
    assert.equal(listedBefore.res.status, 200);
    assert.equal(listedBefore.json.sessions.length, 1);
    assert.equal(listedBefore.json.sessions[0].session_id, sessionId);

    await first.stop();
    first = null;

    second = createServer({ testMode: true, cleanSessionDb: false, sessionDbPath: dbPath, port: 0, host: "127.0.0.1" });
    await second.start({ port: 0, host: "127.0.0.1" });
    const secondBase = second.getBaseUrl();

    const restored = await get(secondBase, `/v1/chat/sessions/${sessionId}`);
    assert.equal(restored.res.status, 200);
    assert.equal(restored.json.messages.length, 2);

    const listedAfter = await get(secondBase, "/v1/users/browser-restart-user/sessions");
    assert.equal(listedAfter.res.status, 200);
    assert.equal(listedAfter.json.sessions.length, 1);
    assert.equal(listedAfter.json.sessions[0].session_id, sessionId);

    const followup = await post(secondBase, `/v1/chat/sessions/${sessionId}/messages`, { role: "user", content: "followup after restart" });
    assert.equal(followup.res.status, 200);

    const final = await get(secondBase, `/v1/chat/sessions/${sessionId}`);
    assert.equal(final.json.messages.length, 4);
  } finally {
    await first?.stop?.();
    await second?.stop?.();
    await cleanupDbFiles(dbPath);
  }
});

integrationTest("session without user_id survives restart, listByUser returns empty", async () => {
  const dbPath = path.join(os.tmpdir(), `cataloguesearch-chat-restart-nouserid-${process.pid}-${Date.now()}.db`);
  await cleanupDbFiles(dbPath);

  let first = null;
  let second = null;
  try {
    first = createServer({ testMode: true, cleanSessionDb: false, sessionDbPath: dbPath, port: 0, host: "127.0.0.1" });
    await first.start({ port: 0, host: "127.0.0.1" });
    const firstBase = first.getBaseUrl();

    const created = await post(firstBase, "/v1/chat/sessions", { provider: "auto" });
    assert.equal(created.res.status, 200);
    const sessionId = created.json.session_id;

    const msg = await post(firstBase, `/v1/chat/sessions/${sessionId}/messages`, { role: "user", content: "question before restart" });
    assert.equal(msg.res.status, 200);

    await first.stop();
    first = null;

    second = createServer({ testMode: true, cleanSessionDb: false, sessionDbPath: dbPath, port: 0, host: "127.0.0.1" });
    await second.start({ port: 0, host: "127.0.0.1" });
    const secondBase = second.getBaseUrl();

    const restored = await get(secondBase, `/v1/chat/sessions/${sessionId}`);
    assert.equal(restored.res.status, 200);
    assert.equal(restored.json.messages.length, 2);

    // No userId on the session — not visible via any userId lookup
    const listed = await get(secondBase, "/v1/users/any-user/sessions");
    assert.equal(listed.res.status, 200);
    assert.equal(listed.json.sessions.length, 0);
  } finally {
    await first?.stop?.();
    await second?.stop?.();
    await cleanupDbFiles(dbPath);
  }
});

async function post(baseUrl, route, body) {
  const res = await fetch(`${baseUrl}${route}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body || {}),
    signal: AbortSignal.timeout(10_000),
  });
  const json = await res.json();
  return { res, json };
}

async function get(baseUrl, route) {
  const res = await fetch(`${baseUrl}${route}`, { signal: AbortSignal.timeout(10_000) });
  const json = await res.json();
  return { res, json };
}

async function cleanupDbFiles(dbPath) {
  for (const target of [dbPath, `${dbPath}-wal`, `${dbPath}-shm`]) {
    await rm(target, { force: true });
  }
}
