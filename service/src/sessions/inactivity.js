// Conversation lifetime is separate from the registry's memory eviction timeout.
export const SESSION_INACTIVITY_MS = 48 * 60 * 60 * 1000;

export function isSessionInactive(session, now = Date.now()) {
  return Boolean(session.claimed && !session.busy &&
    now - session.lastActivityAt >= SESSION_INACTIVITY_MS);
}
