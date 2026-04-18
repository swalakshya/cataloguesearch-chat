import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import { test } from "node:test";
import assert from "node:assert/strict";

import { SessionStore } from "../../src/sessions/session_store.js";

test("SessionStore round-trips persisted sessions", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "session-store-"));
  const dbPath = path.join(dir, "sessions.db");
  const store = new SessionStore(dbPath);

  store.upsert({
    sessionId: "s1",
    userId: null,
    provider: "openai",
    providerSessionId: "provider-session",
    language: "hi",
    model: "gpt-4o",
    createdAt: 100,
    lastActivityAt: 200,
    messages: [{ role: "user", content: "hello" }],
    tokenCount: 5,
    chunkIdMap: { h1: "real-1" },
    chunkIdReverseMap: { "real-1": "h1" },
    chunkIdCounter: 1,
    conversationHistory: [{ id: "set_1", question: "hello", answer: "hi", chunk_ids: [], chunk_scores: [] }],
    busy: true,
  });

  const restored = store.restore("s1");
  assert.equal(restored.sessionId, "s1");
  assert.equal(restored.provider, "openai");
  assert.equal(restored.providerSessionId, null);
  assert.equal(restored.busy, false);
  assert.equal(restored.lastActivityAt, 200);
  assert.deepEqual(restored.messages, [{ role: "user", content: "hello" }]);
  assert.deepEqual(restored.chunkIdMap, { h1: "real-1" });
  assert.equal(restored.chunkIdCounter, 1);

  store.close();
});

test("SessionStore delete removes persisted session", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "session-store-"));
  const dbPath = path.join(dir, "sessions.db");
  const store = new SessionStore(dbPath);

  store.upsert({
    sessionId: "s2",
    provider: "auto",
    providerSessionId: null,
    language: "hi",
    model: null,
    createdAt: 10,
    lastActivityAt: 20,
    messages: [],
    tokenCount: 0,
    chunkIdMap: {},
    chunkIdReverseMap: {},
    chunkIdCounter: 0,
    conversationHistory: [],
    busy: false,
  });

  assert.equal(store.restore("s2").sessionId, "s2");
  store.delete("s2");
  assert.equal(store.restore("s2"), null);

  store.close();
});

function makeSession(overrides = {}) {
  return {
    provider: "auto",
    providerSessionId: null,
    language: "hi",
    model: null,
    createdAt: 100,
    lastActivityAt: 200,
    messages: [],
    tokenCount: 0,
    chunkIdMap: {},
    chunkIdReverseMap: {},
    chunkIdCounter: 0,
    conversationHistory: [],
    busy: false,
    userId: null,
    ...overrides,
  };
}

test("SessionStore round-trips non-null userId", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "session-store-"));
  const store = new SessionStore(path.join(dir, "sessions.db"));

  store.upsert(makeSession({ sessionId: "s3", userId: "browser-abc", language: "gu" }));

  const restored = store.restore("s3");
  assert.equal(restored.userId, "browser-abc");
  assert.equal(restored.language, "gu");

  store.close();
});

test("SessionStore null userId round-trips as null", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "session-store-"));
  const store = new SessionStore(path.join(dir, "sessions.db"));

  store.upsert(makeSession({ sessionId: "s4", userId: null }));

  const restored = store.restore("s4");
  assert.equal(restored.userId, null);

  store.close();
});

test("SessionStore listByUser returns only that user's sessions ordered newest first", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "session-store-"));
  const store = new SessionStore(path.join(dir, "sessions.db"));

  store.upsert(makeSession({ sessionId: "a1", userId: "user-a", lastActivityAt: 100 }));
  store.upsert(makeSession({ sessionId: "a2", userId: "user-a", lastActivityAt: 300 }));
  store.upsert(makeSession({ sessionId: "b1", userId: "user-b", lastActivityAt: 200 }));
  store.upsert(makeSession({ sessionId: "no-user", userId: null, lastActivityAt: 400 }));

  const userA = store.listByUser("user-a");
  assert.equal(userA.length, 2);
  assert.equal(userA[0].session_id, "a2");  // newest first
  assert.equal(userA[1].session_id, "a1");
  assert.equal(userA[0].language, "hi");

  assert.equal(store.listByUser("user-b").length, 1);
  assert.equal(store.listByUser("unknown").length, 0);
  assert.equal(store.listByUser(null).length, 0);

  store.close();
});
