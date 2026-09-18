import { test } from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";

import { MessageJobStore } from "../../src/sessions/message_job_store.js";

function makeTmpDb(name) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `message-job-store-test-${name}-`));
  return path.join(dir, "jobs.db");
}

function insertRaw(store, { messageId, expiresAt }) {
  store.db.prepare(`
    INSERT INTO message_jobs
      (message_id, session_id, status, request_hash, result_json, events_json, created_at, expires_at)
    VALUES
      (@message_id, @session_id, @status, @request_hash, @result_json, @events_json, @created_at, @expires_at)
  `).run({
    message_id: messageId,
    session_id: "session-1",
    status: "done",
    request_hash: "hash",
    result_json: null,
    events_json: null,
    created_at: 1_000_000,
    expires_at: expiresAt,
  });
}

test("pruneExpired deletes rows past expiry and keeps rows not yet expired", () => {
  const store = new MessageJobStore(makeTmpDb("prune-basic"));
  const now = 10_000_000;

  insertRaw(store, { messageId: "expired-1", expiresAt: now - 1 });
  insertRaw(store, { messageId: "expired-2", expiresAt: now - 1_000_000 });
  insertRaw(store, { messageId: "live-1", expiresAt: now + 1 });

  const deleted = store.pruneExpired(now);

  assert.equal(deleted, 2);
  const remaining = store.db.prepare("SELECT message_id FROM message_jobs").all().map((r) => r.message_id);
  assert.deepEqual(remaining, ["live-1"]);

  store.close();
});

test("pruneExpired defaults to Date.now() when no argument is passed", () => {
  const store = new MessageJobStore(makeTmpDb("prune-default"));
  insertRaw(store, { messageId: "long-expired", expiresAt: Date.now() - 1_000_000 });

  const deleted = store.pruneExpired();

  assert.equal(deleted, 1);
  assert.equal(store.db.prepare("SELECT COUNT(*) AS c FROM message_jobs").get().c, 0);

  store.close();
});

test("pruneExpired is a no-op when nothing is expired", () => {
  const store = new MessageJobStore(makeTmpDb("prune-noop"));
  const now = 10_000_000;
  insertRaw(store, { messageId: "live-1", expiresAt: now + 1 });

  const deleted = store.pruneExpired(now);

  assert.equal(deleted, 0);
  assert.equal(store.db.prepare("SELECT COUNT(*) AS c FROM message_jobs").get().c, 1);

  store.close();
});
