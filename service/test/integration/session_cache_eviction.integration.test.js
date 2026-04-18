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

integrationTest("multiple evicted and active sessions continue correctly", async () => {
  await harness.reset();

  const sessions = [];
  for (let i = 0; i < 10; i += 1) {
    const created = await harness.post("/v1/chat/sessions", { provider: "auto" });
    assert.equal(created.res.status, 200);
    sessions.push(created.json.session_id);
  }

  for (let i = 0; i < sessions.length; i += 1) {
    const message = await harness.post(`/v1/chat/sessions/${sessions[i]}/messages`, {
      role: "user",
      content: `initial question ${i + 1}`,
    });
    assert.equal(message.res.status, 200);
  }

  const evictedIds = sessions.slice(0, 5);
  const activeIds = sessions.slice(5);

  const beforeEviction = await harness.get("/v1/test/sessions/in-memory");
  const hotBefore = new Set(beforeEviction.json.session_ids.filter((id) => sessions.includes(id)));
  assert.equal(hotBefore.size, 10);

  const evicted = await harness.post("/v1/test/sessions/evict", { session_ids: evictedIds });
  assert.equal(evicted.res.status, 200);
  assert.deepEqual(evicted.json.evicted_session_ids, evictedIds);

  const afterEviction = await harness.get("/v1/test/sessions/in-memory");
  const hotAfter = new Set(afterEviction.json.session_ids.filter((id) => sessions.includes(id)));
  for (const sessionId of evictedIds) {
    assert.equal(hotAfter.has(sessionId), false);
  }
  for (const sessionId of activeIds) {
    assert.equal(hotAfter.has(sessionId), true);
  }

  for (let i = 0; i < evictedIds.length; i += 1) {
    const restored = await harness.get(`/v1/chat/sessions/${evictedIds[i]}`);
    assert.equal(restored.res.status, 200);
    assert.equal(Array.isArray(restored.json.messages), true);
    assert.equal(restored.json.messages.length, 2);
  }

  for (let i = 0; i < sessions.length; i += 1) {
    const message = await harness.post(`/v1/chat/sessions/${sessions[i]}/messages`, {
      role: "user",
      content: `followup question ${i + 1}`,
    });
    assert.equal(message.res.status, 200);
  }

  for (const sessionId of sessions) {
    const restored = await harness.get(`/v1/chat/sessions/${sessionId}`);
    assert.equal(restored.res.status, 200);
    assert.equal(restored.json.messages.length, 4);
  }
});

integrationTest("sessions with and without user_id evict and restore correctly, listByUser is scoped", async () => {
  await harness.reset();

  const withUserIds = [];
  const withoutUserIds = [];

  for (let i = 0; i < 3; i++) {
    const r = await harness.post("/v1/chat/sessions", { provider: "auto", user_id: "eviction-test-user" });
    assert.equal(r.res.status, 200);
    withUserIds.push(r.json.session_id);
  }
  for (let i = 0; i < 2; i++) {
    const r = await harness.post("/v1/chat/sessions", { provider: "auto" });
    assert.equal(r.res.status, 200);
    withoutUserIds.push(r.json.session_id);
  }

  const all = [...withUserIds, ...withoutUserIds];

  for (const id of all) {
    const r = await harness.post(`/v1/chat/sessions/${id}/messages`, { role: "user", content: "test question" });
    assert.equal(r.res.status, 200);
  }

  // listByUser returns only user's sessions before eviction
  const listedBefore = await harness.get("/v1/users/eviction-test-user/sessions");
  assert.equal(listedBefore.res.status, 200);
  assert.equal(listedBefore.json.sessions.length, 3);

  // Evict all from memory
  await harness.post("/v1/test/sessions/evict", { session_ids: all });
  const inMemory = await harness.get("/v1/test/sessions/in-memory");
  for (const id of all) {
    assert.equal(inMemory.json.session_ids.includes(id), false);
  }

  // All sessions restore from DB regardless of userId
  for (const id of all) {
    const r = await harness.get(`/v1/chat/sessions/${id}`);
    assert.equal(r.res.status, 200);
    assert.equal(r.json.messages.length, 2);
  }

  // listByUser after eviction still returns only user's sessions
  const listedAfter = await harness.get("/v1/users/eviction-test-user/sessions");
  assert.equal(listedAfter.res.status, 200);
  assert.equal(listedAfter.json.sessions.length, 3);
  const listedIds = listedAfter.json.sessions.map(s => s.session_id);
  for (const id of withUserIds) {
    assert.ok(listedIds.includes(id));
  }
  for (const id of withoutUserIds) {
    assert.equal(listedIds.includes(id), false);
  }

  // Sessions without userId are not visible via any userId lookup
  const otherUser = await harness.get("/v1/users/some-other-user/sessions");
  assert.equal(otherUser.res.status, 200);
  assert.equal(otherUser.json.sessions.length, 0);
});
