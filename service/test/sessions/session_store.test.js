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
  store.upsert(makeSession({ sessionId: "s1", userId, claimed: true, lastActivityAt: 1_000 }));
  store.upsert(makeSession({ sessionId: "s2", userId, claimed: true, lastActivityAt: 3_000 }));
  store.upsert(makeSession({ sessionId: "s3", userId, claimed: true, lastActivityAt: 2_000 }));
  store.upsert(makeSession({ sessionId: "s4", userId: "other-user", claimed: true, lastActivityAt: 5_000 }));

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

test("SessionStore listByUser includes a title derived from the first user message", () => {
  const dbPath = makeTmpDb("title");
  const store = new SessionStore(dbPath);
  const userId = "user-title";

  store.upsert(
    makeSession({
      sessionId: "s1",
      userId,
      claimed: true,
      messages: [
        { role: "user", content: "What is dharma?" },
        { role: "assistant", content: "Dharma is..." },
      ],
    })
  );

  const [session] = store.listByUser(userId);
  assert.equal(session.title, "What is dharma?");

  store.close();
});

test("SessionStore listByUser title skips a leading assistant greeting and uses the first user message", () => {
  const dbPath = makeTmpDb("title-greeting");
  const store = new SessionStore(dbPath);
  const userId = "user-title-greeting";

  store.upsert(
    makeSession({
      sessionId: "s1",
      userId,
      claimed: true,
      messages: [
        { role: "assistant", content: "Namaste! How can I help?" },
        { role: "user", content: "Tell me about ahimsa" },
      ],
    })
  );

  const [session] = store.listByUser(userId);
  assert.equal(session.title, "Tell me about ahimsa");

  store.close();
});

test("SessionStore listByUser truncates a long first message for the title", () => {
  const dbPath = makeTmpDb("title-long");
  const store = new SessionStore(dbPath);
  const userId = "user-title-long";
  const longQuestion = "a".repeat(200);

  store.upsert(
    makeSession({
      sessionId: "s1",
      userId,
      claimed: true,
      messages: [{ role: "user", content: longQuestion }],
    })
  );

  const [session] = store.listByUser(userId);
  assert.equal(session.title.length, 121); // 120 chars + ellipsis
  assert.ok(session.title.endsWith("…"));

  store.close();
});

test("SessionStore listByUser returns a null title when there are no messages yet", () => {
  const dbPath = makeTmpDb("title-empty");
  const store = new SessionStore(dbPath);
  const userId = "user-title-empty";

  store.upsert(makeSession({ sessionId: "s1", userId, claimed: true, messages: [] }));

  const [session] = store.listByUser(userId);
  assert.equal(session.title, null);

  store.close();
});

test("SessionStore reassignUser moves all of one user's sessions to another user id", () => {
  const dbPath = makeTmpDb("reassign");
  const store = new SessionStore(dbPath);

  store.upsert(makeSession({ sessionId: "s1", userId: "anon-1" }));
  store.upsert(makeSession({ sessionId: "s2", userId: "anon-1" }));
  store.upsert(makeSession({ sessionId: "s3", userId: "someone-else", claimed: true }));

  const changed = store.reassignUser("anon-1", "real-user-1");
  assert.equal(changed, 2);

  assert.deepEqual(
    store.listByUser("real-user-1").map((s) => s.session_id).sort(),
    ["s1", "s2"]
  );
  assert.equal(store.listByUser("anon-1").length, 0);
  assert.equal(store.listByUser("someone-else").length, 1);

  store.close();
});

test("SessionStore reassignUser is a no-op when the source user has no sessions", () => {
  const dbPath = makeTmpDb("reassign-empty");
  const store = new SessionStore(dbPath);
  assert.equal(store.reassignUser("nobody", "real-user-1"), 0);
  store.close();
});

test("SessionStore listByUser title survives a store re-open against the same DB file (migration path)", () => {
  const dbPath = makeTmpDb("title-migration");
  const store1 = new SessionStore(dbPath);
  const userId = "user-title-migration";
  store1.upsert(
    makeSession({
      sessionId: "s1",
      userId,
      claimed: true,
      messages: [{ role: "user", content: "Old row before title existed" }],
    })
  );
  store1.close();

  // Re-opening simulates a deploy against an existing DB file that predates
  // the title column -- the constructor's migration must not blow up and
  // must still let listByUser select the (now-present) title column.
  const store2 = new SessionStore(dbPath);
  const [session] = store2.listByUser(userId);
  assert.equal(session.title, "Old row before title existed");
  store2.close();
});

// --- claimed flag (closes the "just omit the cookie" authorization bypass,
// and restricts reassignUser to genuinely-unclaimed sessions) ---

test("SessionStore round-trip preserves claimed=true", () => {
  const dbPath = makeTmpDb("claimed-true");
  const store = new SessionStore(dbPath);

  const session = makeSession({ sessionId: "s1", userId: "real-user-1", claimed: true });
  store.upsert(session);

  const restored = store.restore(session.sessionId);
  assert.equal(restored.claimed, true);

  store.close();
});

test("SessionStore round-trip defaults claimed to false when unset", () => {
  const dbPath = makeTmpDb("claimed-default");
  const store = new SessionStore(dbPath);

  const session = makeSession({ sessionId: "s1", userId: "anon-1" });
  store.upsert(session);

  const restored = store.restore(session.sessionId);
  assert.equal(restored.claimed, false);

  store.close();
});

test("SessionStore reassignUser only moves unclaimed sessions", () => {
  const dbPath = makeTmpDb("reassign-unclaimed-only");
  const store = new SessionStore(dbPath);

  store.upsert(makeSession({ sessionId: "s1", userId: "anon-1", claimed: false }));
  store.upsert(makeSession({ sessionId: "s2", userId: "anon-1", claimed: true })); // shouldn't normally happen, but defend anyway

  const changed = store.reassignUser("anon-1", "real-user-1");
  assert.equal(changed, 1);

  const s1 = store.restore("s1");
  assert.equal(s1.userId, "real-user-1");
  assert.equal(s1.claimed, true);

  // s2 stays put -- it was already claimed, reassignUser must not touch it
  const s2 = store.restore("s2");
  assert.equal(s2.userId, "anon-1");
  assert.equal(s2.claimed, true);

  store.close();
});

test("SessionStore reassignUser cannot steal another real user's already-claimed sessions", () => {
  const dbPath = makeTmpDb("reassign-no-steal");
  const store = new SessionStore(dbPath);

  // victim456 is a real, logged-in account with claimed sessions
  store.upsert(makeSession({ sessionId: "victim-session", userId: "victim456", claimed: true }));

  // attacker tries to "merge" victim456's history into their own account
  const merged = store.reassignUser("victim456", "attacker123");
  assert.equal(merged, 0);

  const victimSession = store.restore("victim-session");
  assert.equal(victimSession.userId, "victim456");
  assert.equal(victimSession.claimed, true);

  store.close();
});

test("SessionStore reassignUser updates the persisted data blob, not just the column -- survives eviction+restore", () => {
  const dbPath = makeTmpDb("reassign-data-blob");
  const store = new SessionStore(dbPath);

  store.upsert(makeSession({ sessionId: "s1", userId: "anon-1", claimed: false }));
  store.reassignUser("anon-1", "real-user-1");

  // Simulate the session having been evicted from memory and restored fresh
  // from disk -- fromPersistedRecord prefers data.userId over the row's own
  // user_id column, so if reassignUser only updated the column, this would
  // incorrectly come back as "anon-1".
  const restored = store.restore("s1");
  assert.equal(restored.userId, "real-user-1");
  assert.equal(restored.claimed, true);

  store.close();
});

test("SessionStore reassignUser with no matching sessions returns 0 and touches nothing", () => {
  const dbPath = makeTmpDb("reassign-none");
  const store = new SessionStore(dbPath);
  assert.equal(store.reassignUser("nobody", "real-user-1"), 0);
  store.close();
});

test("SessionStore claimed column survives a store re-open against a pre-existing DB file (migration path)", () => {
  const dbPath = makeTmpDb("claimed-migration");
  const store1 = new SessionStore(dbPath);
  store1.upsert(makeSession({ sessionId: "s1", userId: "real-user-1", claimed: true }));
  store1.close();

  const store2 = new SessionStore(dbPath);
  const restored = store2.restore("s1");
  assert.equal(restored.claimed, true);
  store2.close();
});

test("SessionStore listByUser excludes unclaimed sessions planted under a real user's id", () => {
  const dbPath = makeTmpDb("listbyuser-claimed-only");
  const store = new SessionStore(dbPath);
  const userId = "real-user-1";

  // A genuine, claimed session belonging to this account.
  store.upsert(makeSession({ sessionId: "real-session", userId, claimed: true }));
  // A session planted under the same user_id by an unauthenticated caller
  // (POST /v1/chat/sessions with a guessed/leaked user_id) -- never claimed.
  store.upsert(makeSession({ sessionId: "planted-session", userId, claimed: false }));

  const sessions = store.listByUser(userId);
  assert.deepEqual(sessions.map((s) => s.session_id), ["real-session"]);

  store.close();
});
