import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isSessionInactive, SESSION_INACTIVITY_MS } from '../../src/sessions/inactivity.js';

test('claimed sessions become inactive at exactly 48 hours after the last exchange', () => {
  const session = { claimed: true, lastActivityAt: 1000 };
  assert.equal(SESSION_INACTIVITY_MS, 48 * 60 * 60 * 1000);
  assert.equal(isSessionInactive(session, 1000 + SESSION_INACTIVITY_MS - 1), false);
  assert.equal(isSessionInactive(session, 1000 + SESSION_INACTIVITY_MS), true);
});
test('anonymous and processing sessions are exempt', () => {
  const old = { lastActivityAt: 1 };
  assert.equal(isSessionInactive(old, Date.now()), false);
  assert.equal(isSessionInactive({ ...old, claimed: true, busy: true }, Date.now()), false);
});
