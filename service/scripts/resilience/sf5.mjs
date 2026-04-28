/**
 * SF5 — Multi-tab consistency
 * 1 test: two concurrent streams on the same job see identical events.
 *
 * Workflow under test: basic_question_v1
 */

import {
  assert, testHeader, groupHeader,
  createSession, submitMessage, readStream,
  pickQuestion, sleep,
} from "./helpers.mjs";

export async function runSF5() {
  groupHeader("SF5 — Multi-tab consistency");

  testHeader("SF5-1  Two concurrent streams on same job → identical event sequences");
  const sid = await createSession();
  const { res, json: j } = await submitMessage(sid, pickQuestion(0));
  assert("submit is 202", res.status === 202, `got ${res.status}`);

  await sleep(20); // let job scheduler tick

  // Open both streams concurrently
  const [r1, r2] = await Promise.all([
    readStream(sid, j.message_id),
    readStream(sid, j.message_id),
  ]);

  const types1 = r1.events.map(e => e.type);
  const types2 = r2.events.map(e => e.type);

  assert("both streams got events", r1.events.length > 0 && r2.events.length > 0,
    `stream1=${r1.events.length} stream2=${r2.events.length}`);
  assert("both streams have same event count", r1.events.length === r2.events.length,
    `stream1=${r1.events.length} stream2=${r2.events.length}`);
  assert("both streams have same event types", JSON.stringify(types1) === JSON.stringify(types2),
    `stream1=${JSON.stringify(types1)} stream2=${JSON.stringify(types2)}`);
  assert("both streams have final event", r1.finalPayload != null && r2.finalPayload != null);
  assert("both streams have same answer",
    r1.finalPayload?.answer === r2.finalPayload?.answer,
    `stream1 answer length=${r1.finalPayload?.answer?.length} stream2=${r2.finalPayload?.answer?.length}`);
}
