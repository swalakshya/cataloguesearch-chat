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

test("getCostAnalysis aggregates token usage including cached_input_tokens", () => {
  const store = new RequestLogStore(makeTmpDb("cost-basic"));

  store.upsert({
    requestId: "r1",
    createdAt: 1_000,
    details: {
      llm_calls: [
        { step: "keyword_extract", usage_normalized: { input_tokens: 100, output_tokens: 20, total_tokens: 120, cached_input_tokens: 40 } },
        { step: "answer_synthesis", usage_normalized: { input_tokens: 200, output_tokens: 50, total_tokens: 250, cached_input_tokens: 80 } },
      ],
      llm_usage_summary: { input_tokens: 300, output_tokens: 70, total_tokens: 370, cached_input_tokens: 120 },
    },
  });
  store.upsert({
    requestId: "r2",
    createdAt: 2_000,
    details: {
      llm_calls: [
        { step: "keyword_extract", usage_normalized: { input_tokens: 50, output_tokens: 10, total_tokens: 60, cached_input_tokens: 0 } },
      ],
      llm_usage_summary: { input_tokens: 50, output_tokens: 10, total_tokens: 60, cached_input_tokens: 0 },
    },
  });

  const result = store.getCostAnalysis();

  assert.equal(result.total, 2);
  assert.equal(result.summary.request_count, 2);
  assert.equal(result.summary.input_tokens, 350);
  assert.equal(result.summary.output_tokens, 80);
  assert.equal(result.summary.total_tokens, 430);
  assert.equal(result.summary.cached_input_tokens, 120);

  const r1 = result.requests.find((r) => r.request_id === "r1");
  assert.equal(r1.llm_usage_summary.cached_input_tokens, 120);

  store.close();
});

test("getCostAnalysis step filter excludes non-matching rows and scopes totals correctly", () => {
  const store = new RequestLogStore(makeTmpDb("cost-step-filter"));

  store.upsert({
    requestId: "r1",
    createdAt: 1_000,
    details: {
      llm_calls: [
        { step: "keyword_extract", usage_normalized: { input_tokens: 100, output_tokens: 10, total_tokens: 110, cached_input_tokens: 5 } },
        { step: "answer_synthesis", usage_normalized: { input_tokens: 200, output_tokens: 30, total_tokens: 230, cached_input_tokens: 10 } },
      ],
    },
  });
  store.upsert({
    requestId: "r2",
    createdAt: 2_000,
    details: {
      llm_calls: [
        { step: "filter_map", usage_normalized: { input_tokens: 50, output_tokens: 5, total_tokens: 55, cached_input_tokens: 0 } },
      ],
    },
  });

  // filter to only answer_synthesis — r2 has no matching call, so it's excluded
  const result = store.getCostAnalysis({ steps: ["answer_synthesis"] });

  assert.equal(result.total, 1);
  assert.equal(result.requests[0].request_id, "r1");
  assert.equal(result.requests[0].llm_calls.length, 1);
  assert.equal(result.requests[0].llm_calls[0].step, "answer_synthesis");
  assert.equal(result.summary.input_tokens, 200);
  assert.equal(result.summary.cached_input_tokens, 10);

  store.close();
});

test("getCostAnalysis pagination: total reflects full count, requests is a page slice", () => {
  const store = new RequestLogStore(makeTmpDb("cost-pagination"));

  for (let i = 1; i <= 5; i++) {
    store.upsert({
      requestId: `r${i}`,
      createdAt: i * 1_000,
      details: {
        llm_calls: [
          { step: "keyword_extract", usage_normalized: { input_tokens: 10, output_tokens: 2, total_tokens: 12, cached_input_tokens: 1 } },
        ],
      },
    });
  }

  const page1 = store.getCostAnalysis({ limit: 2, offset: 0 });
  assert.equal(page1.total, 5);
  assert.equal(page1.requests.length, 2);

  const page2 = store.getCostAnalysis({ limit: 2, offset: 2 });
  assert.equal(page2.total, 5);
  assert.equal(page2.requests.length, 2);

  const page3 = store.getCostAnalysis({ limit: 2, offset: 4 });
  assert.equal(page3.total, 5);
  assert.equal(page3.requests.length, 1);

  // summary always covers all 5 rows regardless of page
  assert.equal(page1.summary.request_count, 5);
  assert.equal(page1.summary.cached_input_tokens, 5);

  store.close();
});
