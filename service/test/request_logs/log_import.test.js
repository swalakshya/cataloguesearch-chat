import { test } from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";

import { buildRequestLogRecordsFromLines, migrateRequestLogs } from "../../src/request_logs/log_import.js";
import { RequestLogStore } from "../../src/request_logs/request_log_store.js";

function makeIso(offsetMs) {
  return new Date(Date.UTC(2026, 3, 22, 0, 0, 0, offsetMs)).toISOString();
}

function line(message, fields = {}) {
  return JSON.stringify({
    ts: makeIso(fields.offsetMs || 0),
    level: "info",
    message,
    ...fields,
  });
}

function makeTmpDir(name) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `request-log-import-test-${name}-`));
}

test("buildRequestLogRecordsFromLines reconstructs success and failure rows", () => {
  const lines = [
    line("message_received", {
      offsetMs: 0,
      requestId: "r-success",
      sessionId: "s1",
      request: {
        content: "What is dharma?",
        filters: { content_type: ["Pravachan"] },
      },
    }),
    line("model_routing_attempt", {
      offsetMs: 10,
      requestId: "r-success",
      sessionId: "s1",
      modelId: "gemini-3-flash-preview",
      provider: "gemini",
    }),
    line("keyword_extract_llm_response", {
      offsetMs: 20,
      requestId: "r-success",
      response: '{"language":"hi","workflow":"basic_question_v1","keywords":["q"],"filters":{"content_type":["Pravachan","Granth"]}}',
    }),
    line("keyword_extraction_complete", {
      offsetMs: 30,
      requestId: "r-success",
      sessionId: "s1",
      workflow: "basic_question_v1",
      modelId: "gemini-3-flash-preview",
    }),
    line("workflow_complete", {
      offsetMs: 40,
      requestId: "r-success",
      workflow: "basic_question_v1",
      retrievedChunks: 0,
      toolCallsUsed: 2,
    }),
    line("workflow_complete", {
      offsetMs: 50,
      requestId: "r-success",
      workflow: "basic_question_v1",
      retrievedChunks: 3,
      toolCallsUsed: 4,
    }),
    line("context_prepared", {
      offsetMs: 55,
      requestId: "r-success",
      sessionId: "s1",
      chunks: 3,
    }),
    line("external_api_request", {
      offsetMs: 57,
      requestId: "r-success",
      path: "/api/agent/search",
      payload: {
        query: "धर्म क्या है",
        content_type: ["Pravachan", "Granth", "Books"],
      },
    }),
    line("model_routing_success", {
      offsetMs: 60,
      requestId: "r-success",
      sessionId: "s1",
      modelId: "gemini-3-flash-preview",
      provider: "gemini",
    }),
    line("api_response", {
      offsetMs: 80,
      requestId: "r-success",
      sessionId: "s1",
      response: { provider: "gemini", tool_trace_id: "r-success", answer: "Dharma answer" },
    }),
    line("message_received", {
      offsetMs: 100,
      requestId: "r-failure",
      sessionId: "s2",
      request: { content: "Bad request" },
    }),
    line("model_routing_attempt", {
      offsetMs: 110,
      requestId: "r-failure",
      sessionId: "s2",
      modelId: "gpt-4o",
      provider: "openai",
    }),
    line("message_failed", {
      offsetMs: 130,
      level: "error",
      requestId: "r-failure",
      sessionId: "s2",
      err_message: "Unauthorized",
    }),
  ];

  const records = buildRequestLogRecordsFromLines(lines);
  assert.equal(records.length, 2);

  const success = records.find((record) => record.requestId === "r-success");
  assert.deepEqual(success, {
    requestId: "r-success",
    sessionId: "s1",
    workflow: "basic_question_v1",
    language: "hi",
    latencyMs: 80,
    error: null,
    createdAt: Date.parse(makeIso(0)),
    details: {
      question: "What is dharma?",
      keyword_model: "gemini-3-flash-preview",
      answer_model: "gemini-3-flash-preview",
      provider: "gemini",
      chunks_retrieved: 3,
      tool_calls_used: 6,
      content_type: ["Pravachan", "Granth", "Books"],
      answer: "Dharma answer",
    },
  });

  const failure = records.find((record) => record.requestId === "r-failure");
  assert.deepEqual(failure, {
    requestId: "r-failure",
    sessionId: "s2",
    workflow: null,
    language: null,
    latencyMs: 30,
    error: "Unauthorized",
    createdAt: Date.parse(makeIso(100)),
    details: {
      question: "Bad request",
      keyword_model: "gpt-4o",
      answer_model: null,
      provider: "openai",
      chunks_retrieved: null,
      tool_calls_used: null,
      content_type: null,
      answer: null,
    },
  });
});

test("migrateRequestLogs writes reconstructed request logs into sqlite", async () => {
  const dir = makeTmpDir("sqlite");
  const dbPath = path.join(dir, "cataloguesearch-chat.db");
  const logPath = path.join(dir, "info.log");

  fs.writeFileSync(logPath, [
    line("message_received", {
      offsetMs: 0,
      requestId: "r1",
      sessionId: "s1",
      request: {
        content: "Explain samyak darshan",
        filters: { content_type: ["Books"] },
      },
    }),
    line("keyword_extract_llm_response", {
      offsetMs: 5,
      requestId: "r1",
      response: '{"language":"hi","workflow":"basic_question_v1","keywords":["q"],"filters":{"content_type":["Granth"]}}',
    }),
    line("keyword_extraction_complete", {
      offsetMs: 10,
      requestId: "r1",
      sessionId: "s1",
      workflow: "basic_question_v1",
      modelId: "gemini-2.5-flash",
    }),
    line("workflow_complete", {
      offsetMs: 20,
      requestId: "r1",
      workflow: "basic_question_v1",
      retrievedChunks: 2,
      toolCallsUsed: 3,
    }),
    line("external_api_request", {
      offsetMs: 22,
      requestId: "r1",
      path: "/api/agent/search",
      payload: {
        query: "सम्यक दर्शन",
        content_type: ["Pravachan", "Granth"],
      },
    }),
    line("model_routing_success", {
      offsetMs: 25,
      requestId: "r1",
      sessionId: "s1",
      modelId: "gemini-2.5-flash",
      provider: "gemini",
    }),
    line("api_response", {
      offsetMs: 40,
      requestId: "r1",
      sessionId: "s1",
      response: { provider: "gemini", tool_trace_id: "r1", answer: "Samyak darshan answer" },
    }),
  ].join("\n"));

  const summary = await migrateRequestLogs({
    dbPath,
    logPaths: [logPath],
  });

  assert.equal(summary.filesProcessed, 1);
  assert.equal(summary.recordsPrepared, 1);
  assert.equal(summary.recordsWritten, 1);

  const store = new RequestLogStore(dbPath);
  try {
    const result = store.listSummaries();
    assert.equal(result.total, 1);
    assert.deepEqual(result.rows[0], {
      request_id: "r1",
      session_id: "s1",
      user_id: null,
      question: "Explain samyak darshan",
      latency_ms: 40,
      status: "success",
      created_at: Date.parse(makeIso(0)),
    });

    const detail = store.getByRequestId("r1");
    assert.deepEqual(detail, {
      request_id: "r1",
      session_id: "s1",
      user_id: null,
      workflow: "basic_question_v1",
      language: "hi",
      latency_ms: 40,
      error: null,
      created_at: Date.parse(makeIso(0)),
      details: {
        question: "Explain samyak darshan",
        keyword_model: "gemini-2.5-flash",
        answer_model: "gemini-2.5-flash",
        provider: "gemini",
        chunks_retrieved: 2,
        tool_calls_used: 3,
        content_type: ["Books", "Granth", "Pravachan"],
        answer: "Samyak darshan answer",
      },
    });
  } finally {
    store.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
