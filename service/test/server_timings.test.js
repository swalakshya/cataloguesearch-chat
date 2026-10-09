import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createServer } from '../src/server.js';
import { SessionStore } from '../src/sessions/session_store.js';

test('chat timings match history and survive reopening the database', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'chat-timings-'));
  const dbPath = path.join(dir, 'chat.db');
  const server = createServer({ testMode: true, chatDbPath: dbPath, jwtSecret: '', port: 0, host: '127.0.0.1' });
  let sessionId;
  let result;
  try {
    await server.start({ port: 0, host: '127.0.0.1' });
    const base = server.getBaseUrl();
    const post = (route, body) => fetch(base + route, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    sessionId = (await (await post('/v1/chat/sessions', { provider: 'auto' })).json()).session_id;
    const route = `/v1/chat/sessions/${sessionId}/messages`;
    assert.equal((await post(route, { role: 'user', content: 'What is dharma?', client_message_id: 'timed-message' })).status, 202);
    const deadline = Date.now() + 10000;
    let response;
    do {
      await new Promise(resolve => setTimeout(resolve, 20));
      response = await fetch(`${base}${route}/timed-message/result`);
    } while (response.status === 202 && Date.now() < deadline);
    assert.equal(response.status, 200);
    result = await response.json();
    assert.ok(Number.isFinite(result.timings.total_ms));
    assert.ok(result.timings.total_ms >= 0);
    assert.ok(Object.hasOwn(result.timings.operations, 'understanding'));
    const history = await (await fetch(`${base}/v1/chat/sessions/${sessionId}`)).json();
    assert.deepEqual(history.messages.findLast(m => m.role === 'assistant').timings, result.timings);
  } finally { await server.stop(); }
  const db = new SessionStore(dbPath);
  try {
    assert.deepEqual(db.restore(sessionId).messages.findLast(m => m.role === 'assistant').timings, result.timings);
  } finally { db.close(); fs.rmSync(dir, { recursive: true, force: true }); }
});
