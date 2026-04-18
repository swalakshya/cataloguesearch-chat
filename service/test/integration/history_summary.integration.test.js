import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createIntegrationHarness, isIntegrationEnabled } from "../../test_support/integration_harness.js";

const INTEGRATION_ENABLED = isIntegrationEnabled();
const harness = createIntegrationHarness("history-summary");

async function waitForSummary(sessionId) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const { res, json } = await harness.get(`/v1/test/session/${sessionId}/history`);
    if (res.ok && Array.isArray(json.history) && json.history.length === 1) {
      if (json.history[0]?.question === "Conversation summary") return json.history[0];
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error("summary_not_applied");
}

before(async () => {
  if (!INTEGRATION_ENABLED) return;
  await harness.start();
});

after(async () => {
  if (!INTEGRATION_ENABLED) return;
  await harness.stop();
});

const integrationTest = INTEGRATION_ENABLED ? test : test.skip;

integrationTest("summarizes history after threshold reached", async () => {
  await harness.reset();
  const session = await harness.post("/v1/chat/sessions", { provider: "auto" });
  const sessionId = session.json.session_id;

  await harness.post(`/v1/chat/sessions/${sessionId}/messages`, { role: "user", content: "FORCE_FOLLOWUP Q1" });
  await harness.post(`/v1/chat/sessions/${sessionId}/messages`, { role: "user", content: "FORCE_FOLLOWUP Q2" });
  await harness.post(`/v1/chat/sessions/${sessionId}/messages`, { role: "user", content: "FORCE_FOLLOWUP Q3" });
  await harness.post(`/v1/chat/sessions/${sessionId}/messages`, { role: "user", content: "FORCE_FOLLOWUP Q4" });

  const summary = await waitForSummary(sessionId);
  assert.equal(summary.answer, "test-summary");
});
