/**
 * SF1 — Async job + poll
 * 7 tests covering 202 submission, polling, idempotency, request-hash mismatch,
 * invalid session/message, and response payload shape.
 *
 * Workflow under test: basic_question_v1
 */

import {
  assert, testHeader, groupHeader,
  createSession, submitMessage, pollResult, get, post,
  pickQuestion, sleep,
} from "./helpers.mjs";

export async function runSF1() {
  groupHeader("SF1 — Async job + poll");

  // ── SF1-1: POST /messages → 202 ─────────────────────────────────────────────
  testHeader("SF1-1  POST /messages returns 202 with message_id");
  const sid1 = await createSession();
  const { res: r1, json: j1, clientMessageId: cmid1 } = await submitMessage(sid1, pickQuestion(0));
  assert("status is 202", r1.status === 202, `got ${r1.status}`);
  assert("body has message_id", typeof j1?.message_id === "string" && j1.message_id.length > 0, JSON.stringify(j1));

  // ── SF1-2: Poll /result → eventually 200 ─────────────────────────────────────
  testHeader("SF1-2  Poll /result → eventually returns 200 with answer");
  const { res: r2, json: j2 } = await pollResult(sid1, j1.message_id);
  assert("poll result is 200", r2.status === 200, `got ${r2.status}`);
  assert("result has answer", typeof j2?.answer === "string" && j2.answer.length > 0, JSON.stringify(j2));
  assert("result has references array", Array.isArray(j2?.references), JSON.stringify(j2));
  assert("result has follow_up_questions", Array.isArray(j2?.follow_up_questions), JSON.stringify(j2));

  // ── SF1-3: Idempotent re-submit same client_message_id → same message_id ─────
  testHeader("SF1-3  Idempotent re-submit (same client_message_id) → same message_id");
  const { res: r3a, json: j3a } = await submitMessage(sid1, pickQuestion(0), {
    client_message_id: cmid1,
  });
  // Job is already done → server returns 200 with result inline (no need to poll again).
  // If still processing it would be 202. Accept either.
  assert("re-submit is 200 or 202", r3a.status === 200 || r3a.status === 202, `got ${r3a.status}`);
  assert("re-submit returns same message_id", j3a?.message_id === j1.message_id,
    `original=${j1.message_id} resubmit=${j3a?.message_id}`);
  // The result should still be available
  const { res: r3b, json: j3b } = await pollResult(sid1, j3a.message_id);
  assert("idempotent result still 200", r3b.status === 200);
  assert("idempotent result answer unchanged", j3b?.answer === j2?.answer);

  // ── SF1-4: Request-hash mismatch → 409 ───────────────────────────────────────
  testHeader("SF1-4  Re-submit same client_message_id but different content → 409");
  const { res: r4 } = await submitMessage(sid1, "सच्चा सुख क्या है?", {
    client_message_id: cmid1,
  });
  assert("hash mismatch → 409", r4.status === 409, `got ${r4.status}`);

  // ── SF1-5: Poll non-existent message_id → 404 ────────────────────────────────
  testHeader("SF1-5  Poll /result for unknown message_id → 404");
  const { res: r5 } = await get(`/v1/chat/sessions/${sid1}/messages/nonexistent-msg/result`);
  assert("unknown message → 404", r5.status === 404, `got ${r5.status}`);

  // ── SF1-6: Poll valid message on wrong session → 403 ─────────────────────────
  // 403 (not 404) is intentional: leaking existence of a message_id would be a
  // cross-session info disclosure, so the server returns Forbidden.
  testHeader("SF1-6  Poll /result on wrong session → 403 Forbidden");
  const sid6 = await createSession();
  const { res: r6 } = await get(`/v1/chat/sessions/${sid6}/messages/${j1.message_id}/result`);
  assert("wrong session → 403", r6.status === 403, `got ${r6.status}`);

  // ── SF1-7: 202 returned quickly (< 3 s) ──────────────────────────────────────
  testHeader("SF1-7  202 response latency < 3 s (LLM work deferred)");
  const sid7 = await createSession();
  const t0 = Date.now();
  const { res: r7 } = await submitMessage(sid7, pickQuestion(3));
  const latencyMs = Date.now() - t0;
  assert("status 202", r7.status === 202, `got ${r7.status}`);
  assert(`202 returned in < 3 000 ms (actual: ${latencyMs} ms)`, latencyMs < 3_000);
}
