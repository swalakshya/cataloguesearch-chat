import { log } from "../utils/log.js";

export class SessionRegistry {
  constructor(idleMs, store = null) {
    this.idleMs = idleMs;
    this.store = store || null;
    this.sessions = new Map();
    this.timer = setInterval(() => this.evictIdle(), Math.min(idleMs, 60_000));
    this.timer.unref?.();
  }

  create(session) {
    this.sessions.set(session.sessionId, session);
    this.save(session);
  }

  get(sessionId) {
    const live = this.sessions.get(sessionId);
    if (live) return live;
    if (!this.store) return null;

    log.info("session_memory_miss_restore_attempt", { sessionId });
    const restored = this.store.restore(sessionId);
    if (!restored) {
      log.info("session_restore_miss", { sessionId });
      return null;
    }
    this.sessions.set(sessionId, restored);
    log.info("session_restored", { sessionId, userId: restored.userId ?? null, source: "sqlite" });
    return restored;
  }

  save(session) {
    if (!this.store || !session?.sessionId) return;
    this.store.upsert(session);
  }

  // Moves every live UNCLAIMED session owned by fromUserId onto toUserId
  // (in-memory, so an anonymous chat that's still open at login-time doesn't
  // lag behind the DB until it's evicted/restored), then delegates the
  // persisted rows to the store. Skips already-claimed sessions even if
  // userId happens to match, mirroring the store's own claimed=0 guard --
  // defense in depth against reassignUser being used to steal a real
  // account's history. Returns the store's count -- the DB is the source of
  // truth for how many sessions actually existed under the old id.
  reassignUser(fromUserId, toUserId) {
    for (const session of this.sessions.values()) {
      if (session.userId === fromUserId && !session.claimed) {
        session.userId = toUserId;
        session.claimed = true;
      }
    }
    return this.store?.reassignUser(fromUserId, toUserId) ?? 0;
  }

  listSessionIds() {
    return Array.from(this.sessions.keys());
  }

  clear() {
    for (const [sessionId, session] of this.sessions.entries()) {
      this.#evictLiveSession(sessionId, session);
    }
  }

  shutdown() {
    clearInterval(this.timer);
    this.clear();
  }

  close(sessionId) {
    const session = this.sessions.get(sessionId);
    if (session) {
      this.#evictLiveSession(sessionId, session);
    }
    this.store?.delete(sessionId);
    log.info("session_deleted", {
      sessionId,
      deletedFromStore: Boolean(this.store),
    });
  }

  evict(sessionId) {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    this.#evictLiveSession(sessionId, session);
  }

  #evictLiveSession(sessionId, session) {
    this.sessions.delete(sessionId);
    if (session?.provider?.closeSession) {
      try {
        session.provider.closeSession(session.providerSessionId);
      } catch (_) {
        // ignore
      }
    }
  }

  evictIdle() {
    const now = Date.now();
    for (const [sessionId, session] of this.sessions.entries()) {
      if (now - session.lastActivityAt > this.idleMs) {
        log.info("session_idle_evicting", {
          sessionId,
          idleForMs: now - session.lastActivityAt,
          restorableFromStore: Boolean(this.store),
        });
        this.evict(sessionId);
      }
    }
  }
}
