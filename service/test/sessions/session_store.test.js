import { test, after } from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";

import { SessionStore } from "../../src/sessions/session_store.js";

function makeTmpDb(name) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `session-store-test-${name}-`));
  return path.join(dir, "sessions.db");
}

function makeSession(overrides = {}) {
  return {
    sessionId: "test-session-1",
    userId: null,
    provider: "auto",
    model: "gemini-2.5-flash",
    language: "hi",
    createdAt: 1_000_000,
    lastActivityAt: 2_000_000,
    messages: [{ role: "user", content: "hello" }],
    tokenCount: 10,
    chunkIdMap: { "hash-1": "real-1" },
    chunkIdReverseMap: { "real-1": "hash-1" },
    chunkIdCounter: 1,
    conversationHistory: [{ id: "set_1", question: "hello", answer: "hi" }],
    ...overrides,
  };
}

test("SessionStore round-trip: upsert then restore returns correct data", () => {
  const dbPath = makeTmpDb("round-trip");
  const store = new SessionStore(dbPath);

  const session = makeSession();
  store.upsert(session);

  const restored = store.restore(session.sessionId);
  assert.ok(restored, "restored should not be null");
  assert.equal(restored.sessionId, session.sessionId);
  assert.equal(restored.provider, session.provider);
  assert.equal(restored.model, session.model);
  assert.equal(restored.language, session.language);
  assert.equal(restored.createdAt, session.createdAt);
  assert.equal(restored.lastActivityAt, session.lastActivityAt);
  assert.deepEqual(restored.messages, session.messages);
  assert.equal(restored.tokenCount, session.tokenCount);
  assert.deepEqual(restored.chunkIdMap, session.chunkIdMap);
  assert.deepEqual(restored.chunkIdReverseMap, session.chunkIdReverseMap);
  assert.equal(restored.chunkIdCounter, session.chunkIdCounter);
  assert.deepEqual(restored.conversationHistory, session.conversationHistory);
  assert.equal(restored.busy, false);

  store.close();
});

test("SessionStore delete removes the session", () => {
  const dbPath = makeTmpDb("delete");
  const store = new SessionStore(dbPath);

  const session = makeSession({ sessionId: "del-session" });
  store.upsert(session);

  assert.ok(store.restore(session.sessionId), "should exist before delete");
  store.delete(session.sessionId);
  assert.equal(store.restore(session.sessionId), null, "should be null after delete");

  store.close();
});

test("SessionStore round-trip preserves userId when set", () => {
  const dbPath = makeTmpDb("userid");
  const store = new SessionStore(dbPath);

  const session = makeSession({ sessionId: "user-session", userId: "browser-abc" });
  store.upsert(session);

  const restored = store.restore(session.sessionId);
  assert.equal(restored.userId, "browser-abc");

  store.close();
});

test("SessionStore round-trip preserves null userId", () => {
  const dbPath = makeTmpDb("null-userid");
  const store = new SessionStore(dbPath);

  const session = makeSession({ sessionId: "anon-session", userId: null });
  store.upsert(session);

  const restored = store.restore(session.sessionId);
  assert.equal(restored.userId, null);

  store.close();
});

test("SessionStore listByUser returns sessions for a user ordered by last_activity_at desc", () => {
  const dbPath = makeTmpDb("list-by-user");
  const store = new SessionStore(dbPath);

  const userId = "user-xyz";
  store.upsert(makeSession({ sessionId: "s1", userId, lastActivityAt: 1_000 }));
  store.upsert(makeSession({ sessionId: "s2", userId, lastActivityAt: 3_000 }));
  store.upsert(makeSession({ sessionId: "s3", userId, lastActivityAt: 2_000 }));
  store.upsert(makeSession({ sessionId: "s4", userId: "other-user", lastActivityAt: 5_000 }));

  const sessions = store.listByUser(userId);
  assert.equal(sessions.length, 3);
  assert.deepEqual(
    sessions.map((s) => s.session_id),
    ["s2", "s3", "s1"]
  );
  assert.ok("language" in sessions[0]);
  assert.ok("message_count" in sessions[0]);
  assert.ok("last_activity_at" in sessions[0]);

  store.close();
});
