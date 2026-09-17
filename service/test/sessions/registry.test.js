import { test } from "node:test";
import assert from "node:assert/strict";

import { SessionRegistry } from "../../src/sessions/registry.js";

test("SessionRegistry create/get/close persists and deletes", () => {
  const upserts = [];
  const deletes = [];
  const store = {
    upsert(session) {
      upserts.push(session.sessionId);
    },
    restore() {
      return null;
    },
    delete(sessionId) {
      deletes.push(sessionId);
    },
  };
  const registry = new SessionRegistry(1_000_000, store);
  clearInterval(registry.timer);
  let closed = false;
  const provider = { closeSession: () => (closed = true) };
  registry.create({
    sessionId: "s1",
    provider,
    providerSessionId: "p1",
    lastActivityAt: Date.now(),
  });

  assert.deepEqual(upserts, ["s1"]);
  assert.equal(registry.get("s1").sessionId, "s1");
  registry.close("s1");
  assert.equal(registry.get("s1"), null);
  assert.equal(closed, true);
  assert.deepEqual(deletes, ["s1"]);
});

test("SessionRegistry reassignUser updates live sessions and delegates to the store", () => {
  const storeCalls = [];
  const store = {
    upsert() {},
    restore() {
      return null;
    },
    reassignUser(fromUserId, toUserId) {
      storeCalls.push([fromUserId, toUserId]);
      return 2;
    },
  };
  const registry = new SessionRegistry(1_000_000, store);
  clearInterval(registry.timer);

  registry.create({ sessionId: "s1", userId: "anon-1", lastActivityAt: Date.now() });
  registry.create({ sessionId: "s2", userId: "someone-else", lastActivityAt: Date.now() });

  const merged = registry.reassignUser("anon-1", "real-user-1");

  assert.equal(merged, 2);
  assert.deepEqual(storeCalls, [["anon-1", "real-user-1"]]);
  assert.equal(registry.get("s1").userId, "real-user-1");
  assert.equal(registry.get("s2").userId, "someone-else");
});

test("SessionRegistry reassignUser with no backing store just returns 0", () => {
  const registry = new SessionRegistry(1_000_000, null);
  clearInterval(registry.timer);
  registry.create({ sessionId: "s1", userId: "anon-1", lastActivityAt: Date.now() });
  assert.equal(registry.reassignUser("anon-1", "real-user-1"), 0);
  assert.equal(registry.get("s1").userId, "real-user-1");
});

test("SessionRegistry restores from store on miss", () => {
  let restoreCalls = 0;
  const store = {
    upsert() {},
    restore(sessionId) {
      restoreCalls += 1;
      return {
        sessionId,
        provider: "auto",
        providerSessionId: null,
        language: "hi",
        model: null,
        createdAt: 1,
        lastActivityAt: 2,
        messages: [],
        tokenCount: 0,
        chunkIdMap: {},
        chunkIdReverseMap: {},
        chunkIdCounter: 0,
        conversationHistory: [],
        busy: false,
      };
    },
    delete() {},
  };
  const registry = new SessionRegistry(1_000_000, store);
  clearInterval(registry.timer);

  const restored = registry.get("s2");
  assert.equal(restored.sessionId, "s2");
  assert.equal(restoreCalls, 1);
  assert.equal(registry.get("s2"), restored);
  assert.equal(restoreCalls, 1);
});

test("SessionRegistry idle eviction unloads memory without deleting store row", () => {
  const deletes = [];
  const store = {
    upsert() {},
    restore() {
      return null;
    },
    delete(sessionId) {
      deletes.push(sessionId);
    },
  };
  const registry = new SessionRegistry(10, store);
  clearInterval(registry.timer);
  registry.create({
    sessionId: "s3",
    provider: "auto",
    providerSessionId: null,
    lastActivityAt: Date.now() - 1_000,
  });

  registry.evictIdle();
  assert.equal(registry.sessions.has("s3"), false);
  assert.deepEqual(deletes, []);
});

test("SessionRegistry persists userId on create for sessions with and without user_id", () => {
  const persisted = [];
  const store = {
    upsert(session) {
      persisted.push({ id: session.sessionId, userId: session.userId });
    },
    restore() { return null; },
    delete() {},
  };
  const registry = new SessionRegistry(1_000_000, store);
  clearInterval(registry.timer);

  registry.create({ sessionId: "with-user", userId: "browser-xyz", lastActivityAt: Date.now() });
  registry.create({ sessionId: "no-user", userId: null, lastActivityAt: Date.now() });

  assert.equal(persisted.find(e => e.id === "with-user").userId, "browser-xyz");
  assert.equal(persisted.find(e => e.id === "no-user").userId, null);
});

test("SessionRegistry restore from store preserves userId for sessions with and without user_id", () => {
  function makeRestoreStore(userId) {
    return {
      upsert() {},
      restore(sessionId) {
        return {
          sessionId, userId, provider: "auto", providerSessionId: null,
          language: "hi", model: null, createdAt: 1, lastActivityAt: 2,
          messages: [], tokenCount: 0, chunkIdMap: {}, chunkIdReverseMap: {},
          chunkIdCounter: 0, conversationHistory: [], busy: false,
        };
      },
      delete() {},
    };
  }

  const r1 = new SessionRegistry(1_000_000, makeRestoreStore("browser-xyz"));
  clearInterval(r1.timer);
  assert.equal(r1.get("s1").userId, "browser-xyz");

  const r2 = new SessionRegistry(1_000_000, makeRestoreStore(null));
  clearInterval(r2.timer);
  assert.equal(r2.get("s1").userId, null);
});

test("SessionRegistry reassignUser marks live sessions claimed and skips already-claimed ones", () => {
  const store = {
    upsert() {},
    restore() {
      return null;
    },
    reassignUser(fromUserId, toUserId) {
      return fromUserId === "anon-1" ? 1 : 0;
    },
  };
  const registry = new SessionRegistry(1_000_000, store);
  clearInterval(registry.timer);

  registry.create({ sessionId: "s1", userId: "anon-1", claimed: false, lastActivityAt: Date.now() });
  // Already claimed under "anon-1" somehow (shouldn't normally happen) -- must not be touched.
  registry.create({ sessionId: "s2", userId: "anon-1", claimed: true, lastActivityAt: Date.now() });

  registry.reassignUser("anon-1", "real-user-1");

  assert.equal(registry.get("s1").userId, "real-user-1");
  assert.equal(registry.get("s1").claimed, true);

  assert.equal(registry.get("s2").userId, "anon-1");
  assert.equal(registry.get("s2").claimed, true);
});
