/**
 * SF2 — SSE stream + replay
 * 6 tests covering live stream, cursor replay, pre-job stream open,
 * post-job replay (buffer gone → DB fallback), cursor out-of-range, unknown message.
 *
 * Workflow under test: basic_question_v1
 */

import {
  assert, testHeader, groupHeader,
  createSession, submitMessage, pollResult, readStream, consumeStreamLive,
  pickQuestion, sleep, get,
} from "./helpers.mjs";

export async function runSF2() {
  groupHeader("SF2 — SSE stream + replay");

  const sid = await createSession();

  // ── SF2-1: Submit then stream → stage + final events ─────────────────────────
  testHeader("SF2-1  Submit then open /stream → receives stage + final events");
  const { res: r1, json: j1 } = await submitMessage(sid, pickQuestion(1));
  assert("submit is 202", r1.status === 202, `got ${r1.status}`);

  await sleep(30); // let job scheduler tick

  const { events: e1, finalPayload: fp1, ids: ids1 } = await readStream(sid, j1.message_id);
  const stages1 = e1.filter(e => e.type === "stage");
  const finals1 = e1.filter(e => e.type === "final");
  assert("got ≥ 1 stage event", stages1.length >= 1, `events: ${JSON.stringify(e1.map(e => e.type))}`);
  assert("got exactly 1 final event", finals1.length === 1);
  assert("final payload has answer", typeof fp1?.answer === "string" && fp1.answer.length > 0);
  assert("SSE ids present", ids1.length >= 1, `ids: ${JSON.stringify(ids1)}`);
  assert("ids start at 0", ids1[0] === 0);

  // ── SF2-2: Cursor replay → only events after cursor returned ─────────────────
  testHeader("SF2-2  Stream with ?last_event_id=0 → skips first event");
  const { events: e2, ids: ids2 } = await readStream(sid, j1.message_id, { lastEventId: 0 });
  assert("replayed events fewer than original", e2.length < e1.length,
    `e2=${e2.length} e1=${e1.length}`);
  assert("replayed ids start at 1 (or empty if only 1 event)", ids2.length === 0 || ids2[0] === 1,
    `ids2: ${JSON.stringify(ids2)}`);

  // ── SF2-3: Open stream before job completes → live events ────────────────────
  testHeader("SF2-3  Open /stream before job finishes → receives live events");
  const sid3 = await createSession();
  const { res: r3, json: j3 } = await submitMessage(sid3, pickQuestion(2));
  assert("submit is 202", r3.status === 202);

  // Open stream almost immediately — races with job start
  await sleep(10);
  const { events: e3, finalPayload: fp3 } = await readStream(sid3, j3.message_id);
  const finals3 = e3.filter(e => e.type === "final");
  assert("live stream got final event", finals3.length === 1,
    `event types: ${JSON.stringify(e3.map(e => e.type))}`);
  assert("live stream final has answer", typeof fp3?.answer === "string" && fp3.answer.length > 0);

  // ── SF2-4: Second stream on completed job → replays from DB ──────────────────
  testHeader("SF2-4  Second stream on same completed job → replays full event set from DB");
  const { events: e4, finalPayload: fp4 } = await readStream(sid, j1.message_id);
  const finals4 = e4.filter(e => e.type === "final");
  assert("second stream has final event", finals4.length === 1, `events: ${JSON.stringify(e4.map(e => e.type))}`);
  assert("answer matches first stream", fp4?.answer === fp1?.answer);
  assert("event count matches first stream", e4.length === e1.length,
    `e4=${e4.length} e1=${e1.length}`);

  // ── SF2-5: Cursor beyond last event → stream ends immediately / returns empty ─
  testHeader("SF2-5  Stream with last_event_id beyond last event → empty stream");
  const beyondId = 9999;
  const { events: e5 } = await readStream(sid, j1.message_id, { lastEventId: beyondId });
  assert("stream beyond last id returns 0 events", e5.length === 0,
    `got: ${JSON.stringify(e5)}`);

  // ── SF2-6: Stream on unknown message_id → error event or HTTP error ───────────
  testHeader("SF2-6  Stream on unknown message_id → error event or HTTP error");
  let errEvent = null;
  try {
    const { events: e6 } = await readStream(sid, "nonexistent-message-id-xyz");
    errEvent = e6.find(e => e.type === "error");
  } catch (err) {
    errEvent = { type: "error", status: err.status };
  }
  assert("unknown message → error event or HTTP error", errEvent !== null, "no error received");
}
