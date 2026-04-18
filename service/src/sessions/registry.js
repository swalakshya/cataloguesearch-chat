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
      } catch (err) {
        log.warn("session_close_failed", { sessionId, message: err?.message || String(err) });
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
