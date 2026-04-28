/**
 * SF3 — Mobile & browser resilience
 * 5 tests simulating tab suspend, reload-while-processing, reload-after-completion,
 * partial stream reconnect with cursor, and unrecoverable pending state (no job in DB).
 *
 * Each test simulates what the frontend localStorage + visibilitychange logic does,
 * but driven entirely from this CLI against the running HTTP service.
 *
 * Workflow under test: basic_question_v1
 */

import {
  assert, testHeader, groupHeader,
  createSession, submitMessage, pollResult, readStream, consumeStreamLive,
  get, pickQuestion, sleep, measureMs,
} from "./helpers.mjs";

export async function runSF3() {
  groupHeader("SF3 — Mobile & browser resilience");

  // ── SF3-1: Tab suspend mid-stream → reconnect from cursor ────────────────────
  testHeader("SF3-1  Interrupt stream mid-way, reconnect from cursor → no duplicate final");
  const sid1 = await createSession();
  const { json: j1 } = await submitMessage(sid1, pickQuestion(4));

  await sleep(20);

  // Receive a few events, then abort; record last seen id
  let cursorId = null;
  let aborted = false;
  const ac = new AbortController();
  const partial = await consumeStreamLive(sid1, j1.message_id, {
    signal: ac.signal,
    onEventId: (id) => { cursorId = id; },
    onEvent: (payload) => {
      // Abort after first stage event to simulate tab suspend
      if (!aborted && payload.type === "stage") {
        aborted = true;
        ac.abort();
      }
    },
  }).catch(err => {
    if (err.name === "AbortError") return { events: [], finalPayload: null, lastSeenId: cursorId };
    throw err;
  });

  // Cursor should have advanced
  const hadCursor = cursorId != null;
  // Now reconnect from cursor
  const { events: e1b, finalPayload: fp1b } = await readStream(sid1, j1.message_id, {
    lastEventId: cursorId ?? 0,
  });
  const finals1 = e1b.filter(e => e.type === "final");
  assert("had cursor after interruption", hadCursor, `cursorId=${cursorId}`);
  assert("reconnect stream has exactly 1 final event", finals1.length === 1,
    `event types: ${JSON.stringify(e1b.map(e => e.type))}`);
  assert("final payload has answer", typeof fp1b?.answer === "string" && fp1b.answer.length > 0);

  // ── SF3-2: Reload while processing → poll returns 200 ────────────────────────
  testHeader("SF3-2  'Reload' while processing — poll /result eventually returns 200");
  const sid2 = await createSession();
  const { json: j2 } = await submitMessage(sid2, pickQuestion(5));

  // Immediately (simulate reload): do NOT read stream; just poll result until done
  const { res: r2, json: jRes2 } = await pollResult(sid2, j2.message_id);
  assert("poll after reload returns 200", r2.status === 200, `got ${r2.status}`);
  assert("reload result has answer", typeof jRes2?.answer === "string" && jRes2.answer.length > 0);

  // ── SF3-3: Reload after completion → GET /result returns cached 200 ───────────
  testHeader("SF3-3  'Reload' after job complete — GET /result returns 200 from DB cache");
  // Use the already-completed job from SF3-2
  const { res: r3, json: jRes3 } = await get(`/v1/chat/sessions/${sid2}/messages/${j2.message_id}/result`);
  assert("cached result is 200", r3.status === 200, `got ${r3.status}`);
  assert("cached result matches original", jRes3?.answer === jRes2?.answer);

  // ── SF3-4: Partial stream replay from cursor position ────────────────────────
  testHeader("SF3-4  Stream replay from non-zero cursor → returns only missed events");
  const sid4 = await createSession();
  const { json: j4 } = await submitMessage(sid4, pickQuestion(6));

  // Get all events first
  const { events: eAll, ids: idsAll } = await readStream(sid4, j4.message_id);
  const midCursor = idsAll.length > 2 ? idsAll[Math.floor(idsAll.length / 2)] : 0;

  // Replay from mid-cursor
  const { events: ePartial } = await readStream(sid4, j4.message_id, { lastEventId: midCursor });
  assert("partial replay has fewer events", ePartial.length < eAll.length,
    `partial=${ePartial.length} all=${eAll.length} midCursor=${midCursor}`);
  // Final event must still be included
  const pFinal = ePartial.find(e => e.type === "final");
  assert("partial replay includes final event", pFinal != null);

  // ── SF3-5: Unrecoverable pending state → 404 clears gracefully ───────────────
  testHeader("SF3-5  Stale pending_msg (no matching job in DB) → GET /result returns 404");
  const staleSessionId = await createSession();
  const staleMsgId = "stale-msg-that-never-existed-" + Date.now();
  const { res: r5 } = await get(`/v1/chat/sessions/${staleSessionId}/messages/${staleMsgId}/result`);
  assert("stale pending → 404", r5.status === 404, `got ${r5.status}`);
}
