import { test } from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";

import { RequestLogStore } from "../../src/request_logs/request_log_store.js";
import { SessionStore } from "../../src/sessions/session_store.js";

function makeTmpDb(name) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `request-log-store-test-${name}-`));
  return path.join(dir, "cataloguesearch-chat.db");
}

test("RequestLogStore upserts and lists logs with filters", () => {
  const dbPath = makeTmpDb("filters");
  const sessionStore = new SessionStore(dbPath);
  const store = new RequestLogStore(dbPath);

  sessionStore.upsert({
    sessionId: "s1",
    userId: "u1",
    language: "hi",
    createdAt: 900,
    lastActivityAt: 2_100,
    messages: [],
    conversationHistory: [],
  });
  sessionStore.upsert({
    sessionId: "s2",
    userId: "u2",
    language: "hi",
    createdAt: 2_900,
    lastActivityAt: 3_100,
    messages: [],
    conversationHistory: [],
  });

  store.upsert({
    requestId: "r1",
    sessionId: "s1",
    workflow: "basic_question_v1",
    language: "hi",
    latencyMs: 120,
    error: null,
    createdAt: 1_000,
    details: {
      question: "What is dharma?",
      keyword_model: "gemini-2.5-flash",
      answer_model: "gemini-2.5-flash",
      provider: "gemini",
      chunks_retrieved: 4,
      tool_calls_used: 2,
      answer: "Dharma answer",
    },
  });
  store.upsert({
    requestId: "r2",
    sessionId: "s1",
    workflow: "metadata_question_v1",
    language: "en",
    latencyMs: 80,
    error: "invalid_response_format",
    createdAt: 2_000,
    details: {
      question: "metadata lookup",
      provider: "gemini",
    },
  });
  store.upsert({
    requestId: "r3",
    sessionId: "s2",
    workflow: "basic_question_v1",
    language: "hi",
    latencyMs: 200,
    error: null,
    createdAt: 3_000,
    details: {
      question: "Follow up",
      provider: "openai",
    },
  });

  const all = store.listSummaries();
  assert.equal(all.total, 3);
  assert.deepEqual(
    all.rows.map((row) => row.request_id),
    ["r3", "r2", "r1"]
  );
  assert.equal(all.rows[2].question, "What is dharma?");
  assert.equal(all.rows[2].user_id, "u1");
  assert.equal(all.rows[0].status, "success");

  const onlyErrors = store.listSummaries({ status: "failed" });
  assert.equal(onlyErrors.total, 1);
  assert.equal(onlyErrors.rows[0].request_id, "r2");
  assert.equal(onlyErrors.rows[0].status, "failed");

  const workflowFiltered = store.listSummaries({
    workflow: "basic_question_v1",
    language: "hi",
    from: 1_500,
    to: 3_500,
    userId: "u2",
  });
  assert.equal(workflowFiltered.total, 1);
  assert.equal(workflowFiltered.rows[0].request_id, "r3");

  const requestFiltered = store.listSummaries({ requestId: "r1" });
  assert.equal(requestFiltered.total, 1);
  assert.equal(requestFiltered.rows[0].request_id, "r1");

  const detail = store.getByRequestId("r1");
  assert.equal(detail.user_id, "u1");
  assert.equal(detail.details.answer, "Dharma answer");

  store.close();
  sessionStore.close();
});
