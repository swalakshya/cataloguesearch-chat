import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import { createServer } from "../../src/server.js";
import { isIntegrationEnabled } from "../../test_support/integration_harness.js";

const INTEGRATION_ENABLED = isIntegrationEnabled();

async function waitForHealthy(baseUrl, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${baseUrl}/v1/health`);
      if (res.ok) return;
    } catch {
      // ignore
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("service_not_healthy");
}

async function post(baseUrl, path, body) {
  const res = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body || {}),
  });
  const json = await res.json();
  return { res, json };
}

async function get(baseUrl, path) {
  const res = await fetch(`${baseUrl}${path}`);
  const json = await res.json();
  return { res, json };
}

const integrationTest = INTEGRATION_ENABLED ? test : test.skip;

integrationTest("session survives server restart when persistence is enabled", async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "session-restart-test-"));
  const dbPath = path.join(tmpDir, "sessions.db");

  // Start first server instance
  const server1 = createServer({
    testMode: true,
    cleanSessionDb: true,
    sessionDbPath: dbPath,
    sessionIdleMs: 3_600_000, // 1 hour - won't evict during test
  });
  await server1.start();
  const base1 = server1.getBaseUrl();
  await waitForHealthy(base1);

  // Create a session and send a message
  const { json: sessionJson } = await post(base1, "/v1/chat/sessions", { provider: "auto" });
  const sessionId = sessionJson.session_id;

  const { res: msgRes } = await post(base1, `/v1/chat/sessions/${sessionId}/messages`, {
    role: "user",
    content: "What is dharma?",
    response_format: "structured",
  });
  assert.equal(msgRes.status, 200, "first message should succeed");

  // Verify session has messages
  const { json: sessionBefore } = await get(base1, `/v1/chat/sessions/${sessionId}`);
  assert.equal(sessionBefore.messages.length >= 2, true, "session should have user + assistant messages");

  // Stop first server
  await server1.stop();

  // Start second server instance with same DB
  const server2 = createServer({
    testMode: true,
    cleanSessionDb: false, // do NOT clean - we want to restore
    sessionDbPath: dbPath,
  });
  await server2.start();
  const base2 = server2.getBaseUrl();
  await waitForHealthy(base2);

  // Session should be restorable from the DB
  const { res: sessionRes, json: sessionAfter } = await get(base2, `/v1/chat/sessions/${sessionId}`);
  assert.equal(sessionRes.status, 200, "session should be found after restart");
  assert.equal(sessionAfter.session_id, sessionId);
  assert.equal(sessionAfter.messages.length >= 2, true, "messages should be persisted");

  // Should be able to send another message
  const { res: msg2Res, json: msg2Json } = await post(base2, `/v1/chat/sessions/${sessionId}/messages`, {
    role: "user",
    content: "Tell me more",
    response_format: "structured",
  });
  assert.equal(msg2Res.status, 200, "second message after restart should succeed");
  assert.equal(typeof msg2Json.answer, "string");

  await server2.stop();

  // Cleanup
  try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
});

integrationTest("session without persistence does not survive restart", async () => {
  // First server - no DB
  const server1 = createServer({
    testMode: true,
    sessionDbPath: "", // no persistence
  });
  await server1.start();
  const base1 = server1.getBaseUrl();
  await waitForHealthy(base1);

  const { json: sessionJson } = await post(base1, "/v1/chat/sessions", { provider: "auto" });
  const sessionId = sessionJson.session_id;

  await post(base1, `/v1/chat/sessions/${sessionId}/messages`, {
    role: "user",
    content: "question",
    response_format: "structured",
  });

  await server1.stop();

  // Second server - also no DB
  const server2 = createServer({
    testMode: true,
    sessionDbPath: "", // no persistence
  });
  await server2.start();
  const base2 = server2.getBaseUrl();
  await waitForHealthy(base2);

  const { res: sessionRes } = await get(base2, `/v1/chat/sessions/${sessionId}`);
  assert.equal(sessionRes.status, 404, "session should not be found without persistence");

  await server2.stop();
});

integrationTest("user_id is persisted and sessions can be listed by user", async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "session-userid-test-"));
  const dbPath = path.join(tmpDir, "sessions.db");

  const server = createServer({
    testMode: true,
    cleanSessionDb: true,
    sessionDbPath: dbPath,
  });
  await server.start();
  const base = server.getBaseUrl();
  await waitForHealthy(base);

  const userId = "test-user-browser-abc";

  // Create session with user_id
  const { json: s1 } = await post(base, "/v1/chat/sessions", { provider: "auto", user_id: userId });
  const { json: s2 } = await post(base, "/v1/chat/sessions", { provider: "auto", user_id: userId });
  const { json: s3 } = await post(base, "/v1/chat/sessions", { provider: "auto" }); // no user_id

  // List sessions for user
  const { res: listRes, json: listJson } = await get(base, `/v1/users/${userId}/sessions`);
  assert.equal(listRes.status, 200);
  assert.equal(Array.isArray(listJson.sessions), true);
  assert.equal(listJson.sessions.length, 2);
  const sessionIds = listJson.sessions.map((s) => s.session_id);
  assert.ok(sessionIds.includes(s1.session_id));
  assert.ok(sessionIds.includes(s2.session_id));
  assert.ok(!sessionIds.includes(s3.session_id));

  await server.stop();

  // Cleanup
  try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
});
