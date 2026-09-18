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
  assert.equal(session.title.length, 61); // 60 chars + ellipsis
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

// --- title backfill (a row that predates per-message title derivation, or
// was reassigned by an older reassignUser that didn't set title, otherwise
// has title = NULL forever -- the frontend's `session.title || 'New
// conversation'` fallback then shows every one of these as a generic "New
// conversation" even though the row's `data` blob still has the real
// messages to derive a title from) ---

test("SessionStore reassignUser backfills a missing title from the persisted messages", () => {
  const dbPath = makeTmpDb("reassign-title-backfill");
  const store = new SessionStore(dbPath);

  store.upsert(
    makeSession({
      sessionId: "s1",
      userId: "anon-1",
      claimed: false,
      messages: [{ role: "user", content: "Old anon question" }],
    })
  );
  // Simulate a legacy row saved before title derivation existed.
  store.db.prepare("UPDATE sessions SET title = NULL WHERE session_id = ?").run("s1");

  store.reassignUser("anon-1", "real-user-1");

  const [session] = store.listByUser("real-user-1");
  assert.equal(session.title, "Old anon question");

  store.close();
});

test("SessionStore backfills legacy NULL titles from persisted data on construction", () => {
  const dbPath = makeTmpDb("startup-title-backfill");
  const store1 = new SessionStore(dbPath);
  store1.upsert(
    makeSession({
      sessionId: "s1",
      userId: "user-1",
      claimed: true,
      messages: [{ role: "user", content: "Question from before title existed" }],
    })
  );
  store1.db.prepare("UPDATE sessions SET title = NULL WHERE session_id = ?").run("s1");
  store1.close();

  // Re-opening simulates the next deploy/restart picking up this fix against
  // a DB that already has legacy NULL-title rows in it.
  const store2 = new SessionStore(dbPath);
  const [session] = store2.listByUser("user-1");
  assert.equal(session.title, "Question from before title existed");
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

// --- restore() carries the persisted title into _cachedTitle (a rename
// durability fix: upsert() only re-derives a title when _cachedTitle is
// unset, so without this, a renamed session that gets evicted and restored
// -- e.g. across a server restart, or simply idle-evicted -- would have its
// custom title silently overwritten back to the auto-derived one on its
// next message) ---

test("SessionStore restore carries the persisted title into _cachedTitle", () => {
  const dbPath = makeTmpDb("restore-cached-title");
  const store = new SessionStore(dbPath);
  store.upsert(
    makeSession({ sessionId: "s1", userId: "user-1", claimed: true, messages: [{ role: "user", content: "hello" }] })
  );

  const restored = store.restore("s1");
  assert.equal(restored._cachedTitle, "hello");

  store.close();
});

test("SessionStore restore then upsert again does not revert a renamed title", () => {
  const dbPath = makeTmpDb("restore-rename-durability");
  const store = new SessionStore(dbPath);
  store.upsert(
    makeSession({ sessionId: "s1", userId: "user-1", claimed: true, messages: [{ role: "user", content: "hello" }] })
  );

  // Simulate a rename (see server.js's PATCH route): mutate _cachedTitle on
  // the live/restored object and upsert it, exactly like eviction+restore
  // would hand back to a later request.
  const restored = store.restore("s1");
  restored._cachedTitle = "My renamed chat";
  store.upsert(restored);

  // Simulate another turn happening later: restore again (as if evicted in
  // between) and upsert once more -- the rename must survive this, not
  // revert to the auto-derived "hello".
  const restoredAgain = store.restore("s1");
  assert.equal(restoredAgain._cachedTitle, "My renamed chat");
  store.upsert(restoredAgain);

  const [session] = store.listByUser("user-1");
  assert.equal(session.title, "My renamed chat");

  store.close();
});

// --- deleted flag (soft delete: hides a session from listByUser without
// touching the row, so nothing already tied to the session_id breaks) ---

test("SessionStore setSessionDeleted hides an owned, claimed session from listByUser", () => {
  const dbPath = makeTmpDb("soft-delete");
  const store = new SessionStore(dbPath);
  store.upsert(makeSession({ sessionId: "s1", userId: "user-1", claimed: true }));

  const changed = store.setSessionDeleted("s1", "user-1", true);
  assert.equal(changed, true);

  assert.deepEqual(store.listByUser("user-1"), []);
  store.close();
});

test("SessionStore setSessionDeleted does not remove the row -- restore() still finds it", () => {
  const dbPath = makeTmpDb("soft-delete-row-survives");
  const store = new SessionStore(dbPath);
  store.upsert(makeSession({ sessionId: "s1", userId: "user-1", claimed: true }));

  store.setSessionDeleted("s1", "user-1", true);

  const restored = store.restore("s1");
  assert.ok(restored, "the row must still exist after a soft delete");
  assert.equal(restored.sessionId, "s1");

  store.close();
});

test("SessionStore setSessionDeleted false un-hides a session", () => {
  const dbPath = makeTmpDb("soft-delete-undo");
  const store = new SessionStore(dbPath);
  store.upsert(makeSession({ sessionId: "s1", userId: "user-1", claimed: true }));

  store.setSessionDeleted("s1", "user-1", true);
  assert.deepEqual(store.listByUser("user-1"), []);

  store.setSessionDeleted("s1", "user-1", false);
  const sessions = store.listByUser("user-1");
  assert.deepEqual(sessions.map((s) => s.session_id), ["s1"]);

  store.close();
});

test("SessionStore setSessionDeleted refuses a different user's session and leaves it visible", () => {
  const dbPath = makeTmpDb("soft-delete-wrong-owner");
  const store = new SessionStore(dbPath);
  store.upsert(makeSession({ sessionId: "s1", userId: "victim", claimed: true }));

  const changed = store.setSessionDeleted("s1", "attacker", true);
  assert.equal(changed, false);

  const sessions = store.listByUser("victim");
  assert.deepEqual(sessions.map((s) => s.session_id), ["s1"]);

  store.close();
});

test("SessionStore setSessionDeleted refuses an unclaimed (anonymous) session", () => {
  const dbPath = makeTmpDb("soft-delete-unclaimed");
  const store = new SessionStore(dbPath);
  store.upsert(makeSession({ sessionId: "s1", userId: "anon-1", claimed: false }));

  const changed = store.setSessionDeleted("s1", "anon-1", true);
  assert.equal(changed, false);

  store.close();
});

test("SessionStore deleted column survives a store re-open against a pre-existing DB file (migration path)", () => {
  const dbPath = makeTmpDb("deleted-migration");
  const store1 = new SessionStore(dbPath);
  store1.upsert(makeSession({ sessionId: "s1", userId: "user-1", claimed: true }));
  store1.close();

  const store2 = new SessionStore(dbPath);
  const changed = store2.setSessionDeleted("s1", "user-1", true);
  assert.equal(changed, true);
  assert.deepEqual(store2.listByUser("user-1"), []);
  store2.close();
});

// --- renameSession (a scoped title+last_activity_at update, deliberately
// NOT a full-record upsert -- see server.js's PATCH route, which used to
// rewrite the entire session row, including messages/data, just to change a
// title, racing an in-flight message turn's own full-record persist) ---

test("SessionStore renameSession updates the title and bumps last_activity_at for an owned, claimed session", () => {
  const dbPath = makeTmpDb("rename-basic");
  const store = new SessionStore(dbPath);
  store.upsert(makeSession({ sessionId: "s1", userId: "user-1", claimed: true, lastActivityAt: 1_000 }));

  const before = Date.now();
  const changed = store.renameSession("s1", "user-1", "My renamed chat");
  assert.equal(changed, true);

  const [session] = store.listByUser("user-1");
  assert.equal(session.title, "My renamed chat");
  assert.ok(session.last_activity_at >= before);

  store.close();
});

test("SessionStore renameSession does not touch the persisted messages/data blob", () => {
  const dbPath = makeTmpDb("rename-scoped");
  const store = new SessionStore(dbPath);
  store.upsert(
    makeSession({
      sessionId: "s1",
      userId: "user-1",
      claimed: true,
      messages: [{ role: "user", content: "original question" }],
      conversationHistory: [{ id: "set_1", question: "original question", answer: "original answer" }],
    })
  );

  store.renameSession("s1", "user-1", "A new title");

  const restored = store.restore("s1");
  assert.deepEqual(restored.messages, [{ role: "user", content: "original question" }]);
  assert.deepEqual(restored.conversationHistory, [
    { id: "set_1", question: "original question", answer: "original answer" },
  ]);
  assert.equal(restored._cachedTitle, "A new title");

  store.close();
});

test("SessionStore renameSession refuses a different user's session and leaves it unchanged", () => {
  const dbPath = makeTmpDb("rename-wrong-owner");
  const store = new SessionStore(dbPath);
  store.upsert(makeSession({ sessionId: "s1", userId: "victim", claimed: true, messages: [{ role: "user", content: "hello" }] }));

  const changed = store.renameSession("s1", "attacker", "Hijacked title");
  assert.equal(changed, false);

  const [session] = store.listByUser("victim");
  assert.equal(session.title, "hello");

  store.close();
});

test("SessionStore renameSession refuses an unclaimed (anonymous) session", () => {
  const dbPath = makeTmpDb("rename-unclaimed");
  const store = new SessionStore(dbPath);
  store.upsert(makeSession({ sessionId: "s1", userId: "anon-1", claimed: false }));

  const changed = store.renameSession("s1", "anon-1", "New title");
  assert.equal(changed, false);

  store.close();
});

test("SessionStore renameSession truncates an overlong title with an ellipsis", () => {
  const dbPath = makeTmpDb("rename-truncate");
  const store = new SessionStore(dbPath);
  store.upsert(makeSession({ sessionId: "s1", userId: "user-1", claimed: true }));

  store.renameSession("s1", "user-1", "a".repeat(200));

  const [session] = store.listByUser("user-1");
  assert.equal(session.title.length, 61);
  assert.ok(session.title.endsWith("…"));

  store.close();
});

// --- title truncation is grapheme-aware, not a raw UTF-16 code-unit slice
// (a plain .slice(0, N) can split a surrogate pair, or separate a
// Devanagari base character from its combining matra/virama, right at the
// truncation boundary) ---

test("deriveTitle (via upsert) does not split a surrogate-pair emoji at the truncation boundary", () => {
  const dbPath = makeTmpDb("title-emoji-boundary");
  const store = new SessionStore(dbPath);
  // 59 "a"s + an emoji (a surrogate pair, 2 UTF-16 code units) straddling
  // the old TITLE_MAX_LENGTH=60 boundary -- a raw .slice(0, 60) would keep
  // only the emoji's lone lead surrogate, producing an unpaired/invalid
  // code unit right before the appended ellipsis.
  const content = `${"a".repeat(59)}😀${"b".repeat(20)}`;
  store.upsert(makeSession({ sessionId: "s1", userId: "user-1", claimed: true, messages: [{ role: "user", content }] }));

  const [session] = store.listByUser("user-1");
  assert.ok(!session.title.includes("�"), "must not contain the unicode replacement character");
  // eslint-disable-next-line no-misleading-character-class
  assert.equal([...session.title.replace(/…$/, "")].length, 60);
  assert.equal(session.title, `${"a".repeat(59)}😀…`);

  store.close();
});

test("SessionStore renameSession does not split a surrogate-pair emoji at the truncation boundary", () => {
  const dbPath = makeTmpDb("rename-emoji-boundary");
  const store = new SessionStore(dbPath);
  store.upsert(makeSession({ sessionId: "s1", userId: "user-1", claimed: true }));

  const content = `${"a".repeat(59)}😀${"b".repeat(20)}`;
  store.renameSession("s1", "user-1", content);

  const [session] = store.listByUser("user-1");
  assert.ok(!session.title.includes("�"));
  assert.equal([...session.title.replace(/…$/, "")].length, 60);

  store.close();
});
