import { test } from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";

import jwt from "jsonwebtoken";

import { createServer } from "../src/server.js";
import { TITLE_MAX_LENGTH } from "../src/sessions/session_store.js";

const JWT_SECRET = "test-jwt-secret";

async function waitForHealthy(baseUrl, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${baseUrl}/v1/health`, { signal: AbortSignal.timeout(1_000) });
      if (res.ok) return;
    } catch {
      // ignore
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("service_not_healthy");
}

function cookieHeader(userId) {
  if (!userId) return {};
  const token = jwt.sign({ sub: userId }, JWT_SECRET, { algorithm: "HS256" });
  return { Cookie: `cs_session=${token}` };
}

async function postJson(baseUrl, route, body, headers = {}) {
  const res = await fetch(`${baseUrl}${route}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body || {}),
    signal: AbortSignal.timeout(10_000),
  });
  const json = await res.json();
  return { res, json };
}

async function pollMessageResult(baseUrl, sessionId, messageId, headers = {}, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs;
  const route = `/v1/chat/sessions/${sessionId}/messages/${messageId}/result`;
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 80));
    const res = await fetch(`${baseUrl}${route}`, { headers, signal: AbortSignal.timeout(5_000) });
    if (res.status === 202) continue;
    const json = await res.json();
    return { res, json };
  }
  throw new Error(`poll_timeout: message ${messageId} did not complete within deadline`);
}

// Submits a message and waits for it to finish (mirrors server_request_logs.test.js's helper).
async function sendMessageAndWait(baseUrl, sessionId, body, headers = {}) {
  const submitted = await postJson(baseUrl, `/v1/chat/sessions/${sessionId}/messages`, body, headers);
  return pollMessageResult(baseUrl, sessionId, submitted.json.message_id, headers);
}

async function getJson(baseUrl, route, headers = {}) {
  const res = await fetch(`${baseUrl}${route}`, { headers, signal: AbortSignal.timeout(10_000) });
  const json = await res.json();
  return { res, json };
}

async function deleteJson(baseUrl, route, headers = {}) {
  const res = await fetch(`${baseUrl}${route}`, {
    method: "DELETE",
    headers,
    signal: AbortSignal.timeout(10_000),
  });
  const json = await res.json();
  return { res, json };
}

async function patchJson(baseUrl, route, body, headers = {}) {
  const res = await fetch(`${baseUrl}${route}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body || {}),
    signal: AbortSignal.timeout(10_000),
  });
  const json = await res.json();
  return { res, json };
}

async function withServer(fn, extraOptions = {}) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "server-auth-test-"));
  const dbPath = path.join(tmpDir, "cataloguesearch-chat.db");
  const server = createServer({
    testMode: true,
    cleanSessionDb: true,
    chatDbPath: dbPath,
    jwtSecret: JWT_SECRET,
    port: 0,
    host: "127.0.0.1",
    ...extraOptions,
  });
  await server.start({ port: 0, host: "127.0.0.1" });
  const baseUrl = server.getBaseUrl();
  await waitForHealthy(baseUrl);
  try {
    await fn(baseUrl);
  } finally {
    await server.stop();
  }
}

test("POST /v1/chat/sessions: an authenticated user's real id wins over a spoofed body user_id", async () => {
  await withServer(async (baseUrl) => {
    const { res, json } = await postJson(
      baseUrl,
      "/v1/chat/sessions",
      { provider: "auto", user_id: "someone-elses-id" },
      cookieHeader("real-user-1")
    );
    assert.equal(res.status, 200);

    const list = await getJson(baseUrl, "/v1/users/real-user-1/sessions", cookieHeader("real-user-1"));
    assert.equal(list.res.status, 200);
    assert.deepEqual(
      list.json.sessions.map((s) => s.session_id),
      [json.session_id]
    );
  });
});

test("POST /v1/chat/sessions: anonymous caller's own user_id is still honored", async () => {
  await withServer(async (baseUrl) => {
    const { res, json } = await postJson(baseUrl, "/v1/chat/sessions", {
      provider: "auto",
      user_id: "anon-browser-1",
    });
    assert.equal(res.status, 200);
    assert.ok(json.session_id);
  });
});

test("GET /v1/chat/sessions/:id: the owner can fetch their own session", async () => {
  await withServer(async (baseUrl) => {
    const created = await postJson(baseUrl, "/v1/chat/sessions", {}, cookieHeader("real-user-1"));
    const { res } = await getJson(
      baseUrl,
      `/v1/chat/sessions/${created.json.session_id}`,
      cookieHeader("real-user-1")
    );
    assert.equal(res.status, 200);
  });
});

test("GET /v1/chat/sessions/:id: a different logged-in user is forbidden", async () => {
  await withServer(async (baseUrl) => {
    const created = await postJson(baseUrl, "/v1/chat/sessions", {}, cookieHeader("real-user-1"));
    const { res } = await getJson(
      baseUrl,
      `/v1/chat/sessions/${created.json.session_id}`,
      cookieHeader("real-user-2")
    );
    assert.equal(res.status, 403);
  });
});

test("GET /v1/chat/sessions/:id: an anonymous caller can still fetch an anonymous session", async () => {
  await withServer(async (baseUrl) => {
    const created = await postJson(baseUrl, "/v1/chat/sessions", { user_id: "anon-1" });
    const { res } = await getJson(baseUrl, `/v1/chat/sessions/${created.json.session_id}`);
    assert.equal(res.status, 200);
  });
});

test("DELETE /v1/chat/sessions/:id: a different logged-in user is forbidden and the session survives", async () => {
  await withServer(async (baseUrl) => {
    const created = await postJson(baseUrl, "/v1/chat/sessions", {}, cookieHeader("real-user-1"));
    const del = await deleteJson(
      baseUrl,
      `/v1/chat/sessions/${created.json.session_id}`,
      cookieHeader("real-user-2")
    );
    assert.equal(del.res.status, 403);

    const stillThere = await getJson(
      baseUrl,
      `/v1/chat/sessions/${created.json.session_id}`,
      cookieHeader("real-user-1")
    );
    assert.equal(stillThere.res.status, 200);
  });
});

test("DELETE /v1/chat/sessions/:id: the owner can delete their own session", async () => {
  await withServer(async (baseUrl) => {
    const created = await postJson(baseUrl, "/v1/chat/sessions", {}, cookieHeader("real-user-1"));
    const del = await deleteJson(
      baseUrl,
      `/v1/chat/sessions/${created.json.session_id}`,
      cookieHeader("real-user-1")
    );
    assert.equal(del.res.status, 200);
  });
});

test("GET /v1/users/:userId/sessions: requires authentication", async () => {
  await withServer(async (baseUrl) => {
    const { res } = await getJson(baseUrl, "/v1/users/real-user-1/sessions");
    assert.equal(res.status, 401);
  });
});

test("GET /v1/users/:userId/sessions: a logged-in user cannot list someone else's sessions", async () => {
  await withServer(async (baseUrl) => {
    const { res } = await getJson(baseUrl, "/v1/users/real-user-2/sessions", cookieHeader("real-user-1"));
    assert.equal(res.status, 403);
  });
});

test("POST /v1/users/merge: requires authentication", async () => {
  await withServer(async (baseUrl) => {
    const { res } = await postJson(baseUrl, "/v1/users/merge", { from_anonymous_id: "anon-1" });
    assert.equal(res.status, 401);
  });
});

test("POST /v1/users/merge: moves an anonymous user's sessions onto the logged-in account", async () => {
  await withServer(async (baseUrl) => {
    const anonSession = await postJson(baseUrl, "/v1/chat/sessions", { user_id: "anon-1" });
    assert.equal(anonSession.res.status, 200);

    const merge = await postJson(
      baseUrl,
      "/v1/users/merge",
      { from_anonymous_id: "anon-1" },
      cookieHeader("real-user-1")
    );
    assert.equal(merge.res.status, 200);
    assert.equal(merge.json.merged, 1);

    const list = await getJson(baseUrl, "/v1/users/real-user-1/sessions", cookieHeader("real-user-1"));
    assert.deepEqual(
      list.json.sessions.map((s) => s.session_id),
      [anonSession.json.session_id]
    );
  });
});

test("assistant messages persist response_format, citations, references, follow_up_questions and tool_trace_id for history replay", async () => {
  await withServer(async (baseUrl) => {
    const created = await postJson(baseUrl, "/v1/chat/sessions", {}, cookieHeader("real-user-1"));
    const sessionId = created.json.session_id;

    const sent = await sendMessageAndWait(
      baseUrl,
      sessionId,
      {
        role: "user",
        content: "What is dharma?",
        response_format: "structured",
      },
      cookieHeader("real-user-1")
    );
    assert.equal(sent.res.status, 200);

    const { json } = await getJson(baseUrl, `/v1/chat/sessions/${sessionId}`, cookieHeader("real-user-1"));
    const [userMsg, assistantMsg] = json.messages;

    assert.equal(userMsg.response_format, "structured");

    assert.equal(assistantMsg.role, "assistant");
    assert.equal(assistantMsg.response_format, "structured");
    assert.equal(assistantMsg.tool_trace_id, sent.json.tool_trace_id);
    assert.equal(assistantMsg.question, "What is dharma?");
    assert.deepEqual(assistantMsg.follow_up_questions, sent.json.follow_up_questions);
    assert.deepEqual(assistantMsg.references, sent.json.references);
    assert.deepEqual(assistantMsg.citations, sent.json.citations);
  });
});

test("GET /v1/chat/sessions/:id: omitting the cookie entirely no longer bypasses ownership on a claimed session", async () => {
  await withServer(async (baseUrl) => {
    const created = await postJson(baseUrl, "/v1/chat/sessions", {}, cookieHeader("real-user-1"));
    const { res } = await getJson(baseUrl, `/v1/chat/sessions/${created.json.session_id}`); // no cookie at all
    assert.equal(res.status, 403);
  });
});

test("DELETE /v1/chat/sessions/:id: omitting the cookie entirely no longer bypasses ownership on a claimed session", async () => {
  await withServer(async (baseUrl) => {
    const created = await postJson(baseUrl, "/v1/chat/sessions", {}, cookieHeader("real-user-1"));
    const del = await deleteJson(baseUrl, `/v1/chat/sessions/${created.json.session_id}`); // no cookie
    assert.equal(del.res.status, 403);

    const stillThere = await getJson(
      baseUrl,
      `/v1/chat/sessions/${created.json.session_id}`,
      cookieHeader("real-user-1")
    );
    assert.equal(stillThere.res.status, 200);
  });
});

test("POST /v1/chat/sessions/:id/messages: a different logged-in user cannot write into a claimed session", async () => {
  await withServer(async (baseUrl) => {
    const created = await postJson(baseUrl, "/v1/chat/sessions", {}, cookieHeader("real-user-1"));
    const { res } = await postJson(
      baseUrl,
      `/v1/chat/sessions/${created.json.session_id}/messages`,
      { role: "user", content: "hi" },
      cookieHeader("real-user-2")
    );
    assert.equal(res.status, 403);
  });
});

test("POST /v1/chat/sessions/:id/messages: omitting the cookie cannot write into a claimed session", async () => {
  await withServer(async (baseUrl) => {
    const created = await postJson(baseUrl, "/v1/chat/sessions", {}, cookieHeader("real-user-1"));
    const { res } = await postJson(baseUrl, `/v1/chat/sessions/${created.json.session_id}/messages`, {
      role: "user",
      content: "hi",
    }); // no cookie
    assert.equal(res.status, 403);
  });
});

test("GET .../messages/:id/result: a different logged-in user is forbidden", async () => {
  await withServer(async (baseUrl) => {
    const created = await postJson(baseUrl, "/v1/chat/sessions", {}, cookieHeader("real-user-1"));
    const { res } = await getJson(
      baseUrl,
      `/v1/chat/sessions/${created.json.session_id}/messages/some-id/result`,
      cookieHeader("real-user-2")
    );
    assert.equal(res.status, 403);
  });
});

test("GET .../messages/:id/stream: a different logged-in user is forbidden", async () => {
  await withServer(async (baseUrl) => {
    const created = await postJson(baseUrl, "/v1/chat/sessions", {}, cookieHeader("real-user-1"));
    const { res } = await getJson(
      baseUrl,
      `/v1/chat/sessions/${created.json.session_id}/messages/some-id/stream`,
      cookieHeader("real-user-2")
    );
    assert.equal(res.status, 403);
  });
});

test("POST .../messages/stream: a different logged-in user is forbidden", async () => {
  await withServer(async (baseUrl) => {
    const created = await postJson(baseUrl, "/v1/chat/sessions", {}, cookieHeader("real-user-1"));
    const { res } = await postJson(
      baseUrl,
      `/v1/chat/sessions/${created.json.session_id}/messages/stream`,
      { role: "user", content: "hi", response_format: "structured" },
      cookieHeader("real-user-2")
    );
    assert.equal(res.status, 403);
  });
});

test("Anonymous (unclaimed) sessions remain fully usable via the message routes with no cookie at all", async () => {
  await withServer(async (baseUrl) => {
    const created = await postJson(baseUrl, "/v1/chat/sessions", { user_id: "anon-1" });
    const sent = await sendMessageAndWait(baseUrl, created.json.session_id, {
      role: "user",
      content: "hi",
      response_format: "structured",
    });
    assert.equal(sent.res.status, 200);

    const { res } = await getJson(baseUrl, `/v1/chat/sessions/${created.json.session_id}`);
    assert.equal(res.status, 200);
  });
});

test("POST /v1/users/merge: cannot steal another real user's already-claimed sessions", async () => {
  await withServer(async (baseUrl) => {
    // real-user-1 is a genuine logged-in account with a claimed session
    await postJson(baseUrl, "/v1/chat/sessions", {}, cookieHeader("real-user-1"));

    // attacker tries to "merge" real-user-1's history into their own account
    const merge = await postJson(
      baseUrl,
      "/v1/users/merge",
      { from_anonymous_id: "real-user-1" },
      cookieHeader("attacker-1")
    );
    assert.equal(merge.res.status, 200);
    assert.equal(merge.json.merged, 0);

    // real-user-1 still owns their session
    const list = await getJson(baseUrl, "/v1/users/real-user-1/sessions", cookieHeader("real-user-1"));
    assert.equal(list.json.sessions.length, 1);
  });
});

test("verifyAuth: a malformed cookie value does not 500 the request, degrades to anonymous", async () => {
  await withServer(async (baseUrl) => {
    const res = await fetch(`${baseUrl}/v1/health`, {
      headers: { Cookie: "cs_session=%zz" },
      signal: AbortSignal.timeout(5_000),
    });
    assert.equal(res.status, 200);
  });
});

test("CORS: an empty-string CORS_ALLOWED_ORIGINS (as docker-compose passes when unset) still falls back to the default allow-list", async () => {
  await withServer(
    async (baseUrl) => {
      const res = await fetch(`${baseUrl}/v1/health`, {
        headers: { Origin: "http://localhost:3000" },
        signal: AbortSignal.timeout(5_000),
      });
      assert.equal(res.headers.get("access-control-allow-origin"), "http://localhost:3000");
    },
    { corsAllowedOrigins: "" }
  );
});

// --- PATCH /v1/chat/sessions/:id (rename + soft delete) ---

test("PATCH /v1/chat/sessions/:id: the owner can rename their own session", async () => {
  await withServer(async (baseUrl) => {
    const created = await postJson(baseUrl, "/v1/chat/sessions", {}, cookieHeader("real-user-1"));
    const { res, json } = await patchJson(
      baseUrl,
      `/v1/chat/sessions/${created.json.session_id}`,
      { title: "My renamed chat" },
      cookieHeader("real-user-1")
    );
    assert.equal(res.status, 200);
    assert.equal(json.title, "My renamed chat");

    const list = await getJson(baseUrl, "/v1/users/real-user-1/sessions", cookieHeader("real-user-1"));
    assert.equal(list.json.sessions[0].title, "My renamed chat");
  });
});

test("PATCH /v1/chat/sessions/:id: a different logged-in user cannot rename someone else's session", async () => {
  await withServer(async (baseUrl) => {
    const created = await postJson(baseUrl, "/v1/chat/sessions", {}, cookieHeader("real-user-1"));
    const { res } = await patchJson(
      baseUrl,
      `/v1/chat/sessions/${created.json.session_id}`,
      { title: "Hijacked title" },
      cookieHeader("real-user-2")
    );
    assert.equal(res.status, 403);

    const list = await getJson(baseUrl, "/v1/users/real-user-1/sessions", cookieHeader("real-user-1"));
    assert.equal(list.json.sessions[0].title, null);
  });
});

test("PATCH /v1/chat/sessions/:id: requires authentication", async () => {
  await withServer(async (baseUrl) => {
    const created = await postJson(baseUrl, "/v1/chat/sessions", { user_id: "anon-1" });
    const { res } = await patchJson(baseUrl, `/v1/chat/sessions/${created.json.session_id}`, { title: "x" });
    assert.equal(res.status, 401);
  });
});

test("PATCH /v1/chat/sessions/:id: cannot rename an anonymous (unclaimed) session", async () => {
  await withServer(async (baseUrl) => {
    const created = await postJson(baseUrl, "/v1/chat/sessions", { user_id: "anon-1" });
    const { res } = await patchJson(
      baseUrl,
      `/v1/chat/sessions/${created.json.session_id}`,
      { title: "x" },
      cookieHeader("real-user-1")
    );
    assert.equal(res.status, 403);
  });
});

test("PATCH /v1/chat/sessions/:id: an empty title is rejected", async () => {
  await withServer(async (baseUrl) => {
    const created = await postJson(baseUrl, "/v1/chat/sessions", {}, cookieHeader("real-user-1"));
    const { res } = await patchJson(
      baseUrl,
      `/v1/chat/sessions/${created.json.session_id}`,
      { title: "   " },
      cookieHeader("real-user-1")
    );
    assert.equal(res.status, 400);
  });
});

test("PATCH /v1/chat/sessions/:id: an overlong title is capped with an ellipsis", async () => {
  await withServer(async (baseUrl) => {
    const created = await postJson(baseUrl, "/v1/chat/sessions", {}, cookieHeader("real-user-1"));
    const longTitle = "a".repeat(200);
    const { json } = await patchJson(
      baseUrl,
      `/v1/chat/sessions/${created.json.session_id}`,
      { title: longTitle },
      cookieHeader("real-user-1")
    );
    assert.equal(json.title.length, TITLE_MAX_LENGTH + 1);
    assert.ok(json.title.endsWith("…"));
  });
});

test("PATCH /v1/chat/sessions/:id: an unknown session id is 404", async () => {
  await withServer(async (baseUrl) => {
    const { res } = await patchJson(baseUrl, "/v1/chat/sessions/does-not-exist", { title: "x" }, cookieHeader("real-user-1"));
    assert.equal(res.status, 404);
  });
});

test("PATCH /v1/chat/sessions/:id: an empty body is rejected", async () => {
  await withServer(async (baseUrl) => {
    const created = await postJson(baseUrl, "/v1/chat/sessions", {}, cookieHeader("real-user-1"));
    const { res } = await patchJson(
      baseUrl,
      `/v1/chat/sessions/${created.json.session_id}`,
      {},
      cookieHeader("real-user-1")
    );
    assert.equal(res.status, 400);
  });
});

test("PATCH /v1/chat/sessions/:id: the owner can soft-delete their own session", async () => {
  await withServer(async (baseUrl) => {
    const created = await postJson(baseUrl, "/v1/chat/sessions", {}, cookieHeader("real-user-1"));
    const { res, json } = await patchJson(
      baseUrl,
      `/v1/chat/sessions/${created.json.session_id}`,
      { deleted: true },
      cookieHeader("real-user-1")
    );
    assert.equal(res.status, 200);
    assert.equal(json.deleted, true);

    const list = await getJson(baseUrl, "/v1/users/real-user-1/sessions", cookieHeader("real-user-1"));
    assert.deepEqual(list.json.sessions, []);

    // The row survives -- it's still directly fetchable by id.
    const detail = await getJson(
      baseUrl,
      `/v1/chat/sessions/${created.json.session_id}`,
      cookieHeader("real-user-1")
    );
    assert.equal(detail.res.status, 200);
  });
});

test("PATCH /v1/chat/sessions/:id: a different logged-in user cannot delete someone else's session", async () => {
  await withServer(async (baseUrl) => {
    const created = await postJson(baseUrl, "/v1/chat/sessions", {}, cookieHeader("real-user-1"));
    const { res } = await patchJson(
      baseUrl,
      `/v1/chat/sessions/${created.json.session_id}`,
      { deleted: true },
      cookieHeader("real-user-2")
    );
    assert.equal(res.status, 403);

    const list = await getJson(baseUrl, "/v1/users/real-user-1/sessions", cookieHeader("real-user-1"));
    assert.equal(list.json.sessions.length, 1);
  });
});

test("PATCH /v1/chat/sessions/:id: deleted:false un-hides a previously deleted session", async () => {
  await withServer(async (baseUrl) => {
    const created = await postJson(baseUrl, "/v1/chat/sessions", {}, cookieHeader("real-user-1"));
    await patchJson(
      baseUrl,
      `/v1/chat/sessions/${created.json.session_id}`,
      { deleted: true },
      cookieHeader("real-user-1")
    );
    await patchJson(
      baseUrl,
      `/v1/chat/sessions/${created.json.session_id}`,
      { deleted: false },
      cookieHeader("real-user-1")
    );

    const list = await getJson(baseUrl, "/v1/users/real-user-1/sessions", cookieHeader("real-user-1"));
    assert.equal(list.json.sessions.length, 1);
  });
});
