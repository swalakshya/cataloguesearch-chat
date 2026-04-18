import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { acquireIntegrationLock } from "../../test_support/integration_lock.js";

const BASE = process.env.INTEGRATION_BASE_URL || "";
const INTEGRATION_ENABLED = Boolean(BASE);
let releaseLock = null;

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

async function waitForSummary(sessionId) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const { res, json } = await get(`/v1/test/session/${sessionId}/history`);
    if (res.ok && Array.isArray(json.history) && json.history.length === 1) {
      if (json.history[0]?.question === "Conversation summary") return json.history[0];
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error("summary_not_applied");
}

before(async () => {
  if (!INTEGRATION_ENABLED) return;
  releaseLock = await acquireIntegrationLock();
  await waitForHealthy();
});

after(async () => {
  await releaseLock?.();
});

const integrationTest = INTEGRATION_ENABLED ? test : test.skip;

integrationTest("summarizes history after threshold reached", async () => {
  await post("/v1/test/reset");
  const session = await post("/v1/chat/sessions", { provider: "auto" });
  const sessionId = session.json.session_id;

  await post(`/v1/chat/sessions/${sessionId}/messages`, { role: "user", content: "FORCE_FOLLOWUP Q1" });
  await post(`/v1/chat/sessions/${sessionId}/messages`, { role: "user", content: "FORCE_FOLLOWUP Q2" });
  await post(`/v1/chat/sessions/${sessionId}/messages`, { role: "user", content: "FORCE_FOLLOWUP Q3" });
  await post(`/v1/chat/sessions/${sessionId}/messages`, { role: "user", content: "FORCE_FOLLOWUP Q4" });

  const summary = await waitForSummary(sessionId);
  assert.equal(summary.answer, "test-summary");
});
