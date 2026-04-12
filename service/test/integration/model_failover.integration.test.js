import { test, before } from "node:test";
import assert from "node:assert/strict";

const BASE = process.env.INTEGRATION_BASE_URL || "";
const INTEGRATION_ENABLED = Boolean(BASE);

async function post(path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body || {}),
  });
  const json = await res.json();
  return { res, json };
}

async function get(path) {
  const res = await fetch(`${BASE}${path}`);
  const json = await res.json();
  return { res, json };
}

async function getPromptRoot(requestId) {
  const res = await fetch(`${BASE}/v1/test/prompt-root?request_id=${requestId}`);
  const json = await res.json();
  return { res, json };
}

async function waitForHealthy() {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${BASE}/v1/health`);
      if (res.ok) return;
    } catch {
      // ignore
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error("service_not_healthy");
}

before(async () => {
  if (!INTEGRATION_ENABLED) return;
  await waitForHealthy();
});

const integrationTest = INTEGRATION_ENABLED ? test : test.skip;

integrationTest("fails over to next model on server error", async () => {
  await post("/v1/test/reset");
  await post("/v1/test/provider-behavior", {
    behaviors: {
      "gemini-2.5-flash": "server_error",
      "gemini-3-flash-preview": "success",
      "gpt-4o": "success",
    },
  });

  const session = await post("/v1/chat/sessions", { provider: "auto" });
  const message = await post(`/v1/chat/sessions/${session.json.session_id}/messages`, {
    role: "user",
    content: "question",
  });

  assert.equal(message.res.status, 200);
  assert.equal(message.json.provider, "gemini");
});

integrationTest("returns service_unavailable when all models are unavailable", async () => {
  await post("/v1/test/reset");
  await post("/v1/test/provider-behavior", {
    behaviors: {
      "gemini-2.5-flash": "server_error",
      "gemini-3-flash-preview": "server_error",
      "gpt-4o": "server_error",
    },
  });

  const session = await post("/v1/chat/sessions", { provider: "auto" });
  await post(`/v1/chat/sessions/${session.json.session_id}/messages`, {
    role: "user",
    content: "fail-1",
  });
  await post(`/v1/chat/sessions/${session.json.session_id}/messages`, {
    role: "user",
    content: "fail-2",
  });
  const message = await post(`/v1/chat/sessions/${session.json.session_id}/messages`, {
    role: "user",
    content: "fail-3",
  });

  assert.equal(message.res.status, 503);
  assert.equal(message.json.detail, "service_unavailable");
});

integrationTest("client-side error does not fail over", async () => {
  await post("/v1/test/reset");
  await post("/v1/test/provider-behavior", {
    behaviors: {
      "gemini-2.5-flash": "client_error",
      "gemini-3-flash-preview": "success",
    },
  });

  const session = await post("/v1/chat/sessions", { provider: "auto" });
  const message = await post(`/v1/chat/sessions/${session.json.session_id}/messages`, {
    role: "user",
    content: "client-error",
  });

  assert.equal(message.res.status, 401);

  const stats = await get("/v1/test/provider-stats");
  assert.ok(stats.json.calls["gemini-2.5-flash"] > 0);
  assert.equal(stats.json.calls["gemini-3-flash-preview"], undefined);
});

integrationTest("429 hard-disables model for subsequent requests", async () => {
  await post("/v1/test/reset");
  await post("/v1/test/provider-behavior", {
    behaviors: {
      "gemini-2.5-flash": "rate_limited",
      "gemini-3-flash-preview": "success",
    },
  });

  const session = await post("/v1/chat/sessions", { provider: "auto" });
  await post(`/v1/chat/sessions/${session.json.session_id}/messages`, {
    role: "user",
    content: "rate-limit",
  });

  const statsAfterFirst = await get("/v1/test/provider-stats");
  const countFirst = statsAfterFirst.json.calls["gemini-2.5-flash"] || 0;

  const next = await post(`/v1/chat/sessions/${session.json.session_id}/messages`, {
    role: "user",
    content: "next",
  });

  assert.equal(next.res.status, 200);

  const statsAfterSecond = await get("/v1/test/provider-stats");
  const countSecond = statsAfterSecond.json.calls["gemini-2.5-flash"] || 0;
  assert.equal(countSecond, countFirst);
});

integrationTest("availability is global across sessions", async () => {
  await post("/v1/test/reset");
  await post("/v1/test/provider-behavior", {
    behaviors: {
      "gemini-2.5-flash": "server_error",
      "gemini-3-flash-preview": "success",
    },
  });

  const s1 = await post("/v1/chat/sessions", { provider: "auto" });
  await post(`/v1/chat/sessions/${s1.json.session_id}/messages`, { role: "user", content: "x1" });
  await post(`/v1/chat/sessions/${s1.json.session_id}/messages`, { role: "user", content: "x2" });

  const statsBefore = await get("/v1/test/provider-stats");
  const countBefore = statsBefore.json.calls["gemini-2.5-flash"] || 0;

  const s2 = await post("/v1/chat/sessions", { provider: "auto" });
  const m2 = await post(`/v1/chat/sessions/${s2.json.session_id}/messages`, { role: "user", content: "x3" });

  assert.equal(m2.res.status, 200);

  const statsAfter = await get("/v1/test/provider-stats");
  const countAfter = statsAfter.json.calls["gemini-2.5-flash"] || 0;
  assert.equal(countAfter, countBefore);
});

integrationTest("records model-specific prompt root per request", async () => {
  await post("/v1/test/reset");
  await post("/v1/test/provider-behavior", {
    behaviors: {
      "gemini-2.5-flash": "rate_limited",
      "gemini-3-flash-preview": "success",
    },
  });

  const session = await post("/v1/chat/sessions", { provider: "auto" });
  const message = await post(`/v1/chat/sessions/${session.json.session_id}/messages`, {
    role: "user",
    content: "prompt-root",
  });

  assert.equal(message.res.status, 200);

  const promptRoot = await getPromptRoot(message.json.tool_trace_id);
  assert.equal(promptRoot.res.status, 200);
  assert.ok(String(promptRoot.json.prompt_root).includes("prompts_v2_gemini-3-flash-preview"));
});
