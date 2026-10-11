import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import jwt from 'jsonwebtoken';
import Database from 'better-sqlite3';
import { createServer } from '../src/server.js';

test('inactive account sessions remain readable but reject new turns; renaming cannot renew them', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'chat-inactivity-'));
  const dbPath = path.join(dir, 'chat.db');
  const server = createServer({ testMode: true, chatDbPath: dbPath, jwtSecret: 'secret', port: 0, host: '127.0.0.1' });
  let db;
  try {
    await server.start();
    const base = server.getBaseUrl();
    const cookie = { Cookie: `cs_session=${jwt.sign({ sub: 'owner' }, 'secret')}` };
    const request = (route, method = 'GET', body, headers = cookie) => fetch(base + route, {
      method, headers: { 'Content-Type': 'application/json', ...headers },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const session = await (await request('/v1/chat/sessions', 'POST', {})).json();
    const route = `/v1/chat/sessions/${session.session_id}`;
    db = new Database(dbPath);
    const old = Date.now() - 48 * 60 * 60 * 1000;
    db.prepare('UPDATE sessions SET last_activity_at = ? WHERE session_id = ?').run(old, session.session_id);
    await request('/v1/test/sessions/evict', 'POST', { session_ids: [session.session_id] });
    const historical = await request(route);
    assert.equal(historical.status, 200);
    assert.equal((await historical.json()).read_only, true);
    const renamed = await request(route, 'PATCH', { title: 'Renamed old chat' });
    assert.equal(renamed.status, 200);
    const rejected = await request(route + '/messages', 'POST', { role: 'user', content: 'A new question' });
    assert.equal(rejected.status, 409);
    assert.equal((await rejected.json()).detail, 'session_inactive');
    const streamRejected = await request(route + '/messages/stream', 'POST', { role: 'user', content: 'Bypass attempt', response_format: 'summary' });
    assert.equal(streamRejected.status, 409);
    assert.equal((await streamRejected.json()).detail, 'session_inactive');
    const history = await (await request('/v1/users/owner/sessions')).json();
    assert.equal(history.sessions[0].last_activity_at, old);
    assert.equal(db.prepare('SELECT count(*) AS n FROM message_jobs').get().n, 0);
    // Reopening and renaming must not prolong its conversation lifetime.
    assert.equal((await (await request(route)).json()).read_only, true);
    const fresh = await (await request('/v1/chat/sessions', 'POST', {})).json();
    assert.equal((await (await request(`/v1/chat/sessions/${fresh.session_id}`)).json()).read_only, false);
  } finally {
    db?.close();
    await server.stop();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
