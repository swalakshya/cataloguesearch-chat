import { test } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";

import Database from "better-sqlite3";

import { createServer } from "../src/server.js";

async function waitForHealthy(baseUrl, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${baseUrl}/v1/health`, {
        signal: AbortSignal.timeout(1_000),
      });
      if (res.ok) return;
    } catch {
      // ignore
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("service_not_healthy");
}

async function postJson(baseUrl, route, body, headers = {}) {
  const res = await fetch(`${baseUrl}${route}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...headers,
    },
    body: JSON.stringify(body || {}),
    signal: AbortSignal.timeout(10_000),
  });
  if (res.status === 202 && /\/messages$/.test(route)) {
    const submitted = await res.json();
    const sessionId = route.match(/\/sessions\/([^/]+)\/messages/)?.[1];
    if (sessionId && submitted?.message_id) {
      return pollMessageResult(baseUrl, sessionId, submitted.message_id);
    }
    return { res, json: submitted };
  }
  const json = await res.json();
  return { res, json };
}

async function getJson(baseUrl, route, headers = {}) {
  const res = await fetch(`${baseUrl}${route}`, {
    headers,
    signal: AbortSignal.timeout(10_000),
  });
  const json = await res.json();
  return { res, json };
}

async function pollMessageResult(baseUrl, sessionId, messageId, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs;
  const route = `/v1/chat/sessions/${sessionId}/messages/${messageId}/result`;
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 80));
    const res = await fetch(`${baseUrl}${route}`, {
      signal: AbortSignal.timeout(5_000),
    });
    if (res.status === 202) continue;
    const json = await res.json();
    return { res, json };
  }
  throw new Error(`poll_timeout: message ${messageId} did not complete within deadline`);
}

test("shared chat DB stores feedback and request logs, and exposes admin request log API", async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "server-request-logs-test-"));
  const dbPath = path.join(tmpDir, "cataloguesearch-chat.db");
  const adminApiKey = "test-admin-key";
  const server = createServer({
    testMode: true,
    cleanSessionDb: true,
    chatDbPath: dbPath,
    adminApiKey,
    port: 0,
    host: "127.0.0.1",
  });

  try {
    await server.start({ port: 0, host: "127.0.0.1" });
    const baseUrl = server.getBaseUrl();
    await waitForHealthy(baseUrl);

    const auth = await postJson(baseUrl, "/v1/admin/auth", {
      key_hash: crypto.createHash("sha256").update(adminApiKey).digest("hex"),
    });
    assert.equal(auth.res.status, 200);
    assert.equal(typeof auth.json.token, "string");
    const adminHeaders = {
      Authorization: `Bearer ${auth.json.token}`,
    };

    const session = await postJson(baseUrl, "/v1/chat/sessions", {
      provider: "auto",
      user_id: "user-1",
    });
    assert.equal(session.res.status, 200);
    const sessionId = session.json.session_id;

    const message = await postJson(baseUrl, `/v1/chat/sessions/${sessionId}/messages`, {
      role: "user",
      content: "What is dharma?",
      response_format: "structured",
      filters: {
        content_type: ["Books"],
      },
    });
    assert.equal(message.res.status, 200);
    assert.equal(typeof message.json.tool_trace_id, "string");

    const feedback = await postJson(baseUrl, "/v1/feedback", {
      vote: "helpful",
      request_id: message.json.tool_trace_id,
      question: "What is dharma?",
      answer: message.json.answer,
      references: message.json.references,
      citations: message.json.citations,
    });
    assert.equal(feedback.res.status, 201);

    const requestLogs = await getJson(baseUrl, "/v1/admin/request-logs", adminHeaders);
    assert.equal(requestLogs.res.status, 200);
    assert.equal(requestLogs.json.total, 1);
    assert.equal(requestLogs.json.logs[0].request_id, message.json.tool_trace_id);
    assert.equal(requestLogs.json.logs[0].session_id, sessionId);
    assert.equal(requestLogs.json.logs[0].user_id, "user-1");
    assert.equal(requestLogs.json.logs[0].status, "success");
    assert.equal(requestLogs.json.logs[0].question, "What is dharma?");
    assert.equal(typeof requestLogs.json.logs[0].latency_ms, "number");

    const requestLogDetail = await getJson(
      baseUrl,
      `/v1/admin/request-logs/${encodeURIComponent(message.json.tool_trace_id)}`,
      adminHeaders
    );
    assert.equal(requestLogDetail.res.status, 200);
    assert.equal(requestLogDetail.json.request_id, message.json.tool_trace_id);
    assert.equal(requestLogDetail.json.session_id, sessionId);
    assert.equal(requestLogDetail.json.user_id, "user-1");
    assert.equal(requestLogDetail.json.error, null);
    assert.equal(requestLogDetail.json.details.question, "What is dharma?");
    assert.deepEqual(requestLogDetail.json.details.content_type, ["Books"]);
    assert.equal(requestLogDetail.json.details.answer, "test-answer");
    assert.equal(typeof requestLogDetail.json.details.keyword_model, "string");
    assert.equal(typeof requestLogDetail.json.details.provider, "string");

    const invalidMessage = await postJson(baseUrl, `/v1/chat/sessions/${sessionId}/messages`, {
      role: "user",
      content: "Bad response format request",
      response_format: "invalid",
    });
    assert.equal(invalidMessage.res.status, 400);

    const errorLogs = await getJson(baseUrl, "/v1/admin/request-logs?status=failed", adminHeaders);
    assert.equal(errorLogs.res.status, 200);
    assert.equal(errorLogs.json.total, 1);
    assert.equal(errorLogs.json.logs[0].status, "failed");

    const userLogs = await getJson(baseUrl, "/v1/admin/request-logs?user_id=user-1", adminHeaders);
    assert.equal(userLogs.res.status, 200);
    assert.equal(userLogs.json.total, 2);

    const db = new Database(dbPath, { readonly: true });
    try {
      const feedbackCount = db.prepare("SELECT COUNT(*) AS total FROM feedback").get().total;
      const requestLogCount = db.prepare("SELECT COUNT(*) AS total FROM request_logs").get().total;
      assert.equal(feedbackCount, 1);
      assert.equal(requestLogCount, 2);
    } finally {
      db.close();
    }
  } finally {
    await server.stop();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
