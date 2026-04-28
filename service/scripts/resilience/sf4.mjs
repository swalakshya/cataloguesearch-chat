/**
 * SF4 — Error flows
 * 4 tests: invalid session, invalid message, transient submit failure retry, server restart mid-job.
 *
 * SF4-4 performs a real server restart: pkill + respawn via `npm start` (reads .env.local).
 * Requires CHAT_DB_PATH to be set so jobs persist across restart.
 */

import { execSync, spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  assert, testHeader, groupHeader,
  createSession, submitMessage, pollResult, get, post, BASE,
  pickQuestion, sleep, waitForHealth,
} from "./helpers.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SERVICE_DIR = path.resolve(__dirname, "../..");

export async function runSF4() {
  groupHeader("SF4 — Error flows");

  // ── SF4-1: Invalid session → 404 ─────────────────────────────────────────────
  testHeader("SF4-1  Submit to non-existent session → 404");
  const { res: r1 } = await submitMessage("nonexistent-session-xyz", pickQuestion(7));
  assert("invalid session → 404", r1.status === 404, `got ${r1.status}`);

  // ── SF4-2: GET /result for invalid message on valid session → 404 ─────────────
  testHeader("SF4-2  GET /result for invalid message_id on valid session → 404");
  const sid2 = await createSession();
  const { res: r2 } = await get(`/v1/chat/sessions/${sid2}/messages/bad-msg-id/result`);
  assert("invalid message → 404", r2.status === 404, `got ${r2.status}`);

  // ── SF4-3: Transient failure simulation → client retry succeeds ───────────────
  testHeader("SF4-3  Client retry after transient failure → idempotent second submit succeeds");
  const sid3 = await createSession();
  const content3 = pickQuestion(8);

  // First submit
  const { res: r3a, json: j3a, clientMessageId: cmid3 } = await submitMessage(sid3, content3);
  assert("first submit is 202", r3a.status === 202, `got ${r3a.status}`);

  // Simulate client "thinking it failed" and retrying with same clientMessageId
  await sleep(50);
  const { res: r3b, json: j3b } = await submitMessage(sid3, content3, { client_message_id: cmid3 });
  assert("retry is 200 or 202 (idempotent)", r3b.status === 200 || r3b.status === 202, `got ${r3b.status}`);
  assert("retry returns same message_id", j3b?.message_id === j3a?.message_id,
    `first=${j3a?.message_id} retry=${j3b?.message_id}`);

  // Wait for result
  const { res: r3c, json: j3c } = await pollResult(sid3, j3a.message_id);
  assert("result after retry is 200", r3c.status === 200, `got ${r3c.status}`);
  assert("answer present after retry", typeof j3c?.answer === "string" && j3c.answer.length > 0);

  // ── SF4-4: Server restart mid-job → result persisted in DB ───────────────────
  testHeader("SF4-4  Server restart after job completes → GET /result still returns 200 from DB");

  const sid4 = await createSession();
  const { res: r4a, json: j4a } = await submitMessage(sid4, pickQuestion(9));
  assert("pre-restart submit is 202", r4a.status === 202, `got ${r4a.status}`);

  // Wait for job to complete before restarting
  const { res: r4b, json: j4b } = await pollResult(sid4, j4a.message_id, { timeoutMs: 90_000 });
  const jobDone = r4b.status === 200;
  assert("job completed before restart", jobDone, `status=${r4b.status}`);

  if (!jobDone) {
    assert("SF4-4 skipped — job did not complete", false, "cannot test restart without completed job");
    return;
  }

  const originalAnswer = j4b.answer;

  // Restart the server
  console.log("    [restart] killing service process...");
  try {
    execSync(`pkill -f "node.*service/src/server.js" 2>/dev/null || true`);
    execSync(`pkill -f "npm.*start" 2>/dev/null || true`);
  } catch {}

  await sleep(1_500);

  console.log("    [restart] spawning service...");
  const child = spawn("npm", ["start"], {
    cwd: SERVICE_DIR,
    detached: true,
    stdio: "ignore",
    env: { ...process.env },
  });
  child.unref();

  const healthy = await waitForHealth(30_000);
  assert("service came back healthy after restart", healthy);

  if (!healthy) return;

  // Poll the same message_id after restart — should come from DB
  const { res: r4c, json: j4c } = await get(
    `/v1/chat/sessions/${sid4}/messages/${j4a.message_id}/result`
  );
  assert("result still 200 after restart", r4c.status === 200, `got ${r4c.status}`);
  assert("answer persisted across restart", j4c?.answer === originalAnswer);
}
