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

async function postStream(path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body || {}),
  });
  assert.equal(res.ok, true);

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const events = [];

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";
    for (const line of lines) {
      if (!line.startsWith("data: ")) continue;
      events.push(JSON.parse(line.slice(6)));
    }
  }

  return events;
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

integrationTest("structured chat stream emits progress stages before final response", async () => {
  await post("/v1/test/reset");
  const session = await post("/v1/chat/sessions", { provider: "auto" });
  const sessionId = session.json.session_id;

  const events = await postStream(`/v1/chat/sessions/${sessionId}/messages/stream`, {
    role: "user",
    content: "What is Atma?",
    response_format: "structured",
  });

  assert.equal(events.length >= 4, true);
  assert.deepEqual(
    events.slice(0, 3).map((event) => event.stage),
    ["understanding", "searching", "preparing"]
  );
  assert.deepEqual(
    events.slice(0, 3).map((event) => event.label),
    [
      "Understanding your question",
      "Searching through our scriptures",
      "Preparing answer",
    ]
  );
  const finalEvent = events.at(-1);
  assert.equal(finalEvent.type, "final");
  assert.equal(typeof finalEvent.data?.answer, "string");
  assert.ok(Array.isArray(finalEvent.data?.follow_up_questions));
});
