import { log } from "../utils/log.js";

export class SessionRegistry {
  constructor(idleMs) {
    this.idleMs = idleMs;
    this.sessions = new Map();
    this.timer = setInterval(() => this.evictIdle(), Math.min(idleMs, 60_000));
    this.timer.unref?.();
  }

  create(session) {
    this.sessions.set(session.sessionId, session);
  }

  get(sessionId) {
    return this.sessions.get(sessionId) || null;
  }

  close(sessionId) {
    const session = this.sessions.get(sessionId);
    if (!session) return;
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
        log.info("session_idle_evicted", { sessionId });
        this.close(sessionId);
      }
    }
  }
}
