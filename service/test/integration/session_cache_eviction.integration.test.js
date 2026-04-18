import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createIntegrationHarness, isIntegrationEnabled } from "../../test_support/integration_harness.js";

const INTEGRATION_ENABLED = isIntegrationEnabled();
const harness = createIntegrationHarness("session-cache-eviction");

before(async () => {
  if (!INTEGRATION_ENABLED) return;
  await harness.start();
});

after(async () => {
  if (!INTEGRATION_ENABLED) return;
  await harness.stop();
});

const integrationTest = INTEGRATION_ENABLED ? test : test.skip;

integrationTest("session survives memory eviction when persistence is enabled", async () => {
  await harness.post("/v1/test/reset");

  // Create session and send a message
  const { json: sessionJson } = await harness.post("/v1/chat/sessions", { provider: "auto" });
  const sessionId = sessionJson.session_id;

  await harness.post(`/v1/chat/sessions/${sessionId}/messages`, {
    role: "user",
    content: "What is Atma?",
    response_format: "structured",
  });

  // Verify session is in memory
  const { json: inMemoryBefore } = await harness.get("/v1/test/sessions/in-memory");
  assert.ok(inMemoryBefore.session_ids.includes(sessionId), "session should be in memory after message");

  // Evict session from memory (simulates idle eviction)
  const { json: evictResult } = await harness.post("/v1/test/sessions/evict", {
    session_ids: [sessionId],
  });
  assert.ok(evictResult.evicted_session_ids.includes(sessionId), "session should be evicted");

  // Verify session is no longer in memory
  const { json: inMemoryAfter } = await harness.get("/v1/test/sessions/in-memory");
  assert.ok(!inMemoryAfter.session_ids.includes(sessionId), "session should not be in memory after eviction");

  // Session should still be accessible (restored from store)
  const { res: sessionRes, json: sessionData } = await harness.get(`/v1/chat/sessions/${sessionId}`);
  assert.equal(sessionRes.status, 200, "evicted session should be restorable from store");
  assert.equal(sessionData.session_id, sessionId);

  // Session should be back in memory after restoration
  const { json: inMemoryRestored } = await harness.get("/v1/test/sessions/in-memory");
  assert.ok(inMemoryRestored.session_ids.includes(sessionId), "restored session should be in memory");
});

integrationTest("evicted session can still receive messages after restoration", async () => {
  await harness.post("/v1/test/reset");

  const { json: sessionJson } = await harness.post("/v1/chat/sessions", { provider: "auto" });
  const sessionId = sessionJson.session_id;

  // Send first message
  const { res: msg1Res } = await harness.post(`/v1/chat/sessions/${sessionId}/messages`, {
    role: "user",
    content: "first question",
    response_format: "structured",
  });
  assert.equal(msg1Res.status, 200);

  // Evict from memory
  await harness.post("/v1/test/sessions/evict", { session_ids: [sessionId] });

  // Send second message after eviction (should restore from store)
  const { res: msg2Res, json: msg2Json } = await harness.post(`/v1/chat/sessions/${sessionId}/messages`, {
    role: "user",
    content: "second question",
    response_format: "structured",
  });
  assert.equal(msg2Res.status, 200, "message after eviction should succeed");
  assert.equal(typeof msg2Json.answer, "string");
});
