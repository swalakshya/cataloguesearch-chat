import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createIntegrationHarness, isIntegrationEnabled } from "../../test_support/integration_harness.js";
import { getPromptRootForModel } from "../../src/orchestrator/prompts.js";
import { getOrderedModels } from "../../src/routing/model_registry.js";

const INTEGRATION_ENABLED = isIntegrationEnabled();
const harness = createIntegrationHarness("model-failover");
const [PRIMARY_MODEL, SECONDARY_MODEL, TERTIARY_MODEL] = getOrderedModels().map((model) => model.id);

before(async () => {
  if (!INTEGRATION_ENABLED) return;
  await harness.start();
});

after(async () => {
  if (!INTEGRATION_ENABLED) return;
  await harness.stop();
});

const integrationTest = INTEGRATION_ENABLED ? test : test.skip;

integrationTest("fails over to next model on server error", async () => {
  await harness.post("/v1/test/reset");
  await harness.post("/v1/test/provider-behavior", {
    behaviors: {
      [PRIMARY_MODEL]: "server_error",
      [SECONDARY_MODEL]: "success",
      [TERTIARY_MODEL]: "success",
    },
  });

  const session = await harness.post("/v1/chat/sessions", { provider: "auto" });
  const message = await harness.post(`/v1/chat/sessions/${session.json.session_id}/messages`, {
    role: "user",
    content: "question",
  });

  assert.equal(message.res.status, 200);
  assert.equal(message.json.provider, "gemini");
});

integrationTest("returns service_unavailable when all models are unavailable", async () => {
  await harness.post("/v1/test/reset");
  await harness.post("/v1/test/provider-behavior", {
    behaviors: {
      [PRIMARY_MODEL]: "server_error",
      [SECONDARY_MODEL]: "server_error",
      [TERTIARY_MODEL]: "server_error",
    },
  });

  const session = await harness.post("/v1/chat/sessions", { provider: "auto" });
  await harness.post(`/v1/chat/sessions/${session.json.session_id}/messages`, {
    role: "user",
    content: "fail-1",
  });
  await harness.post(`/v1/chat/sessions/${session.json.session_id}/messages`, {
    role: "user",
    content: "fail-2",
  });
  const message = await harness.post(`/v1/chat/sessions/${session.json.session_id}/messages`, {
    role: "user",
    content: "fail-3",
  });

  assert.equal(message.res.status, 503);
  assert.equal(message.json.detail, "service_unavailable");
});

integrationTest("client-side error does not fail over", async () => {
  await harness.post("/v1/test/reset");
  await harness.post("/v1/test/provider-behavior", {
    behaviors: {
      [PRIMARY_MODEL]: "client_error",
      [SECONDARY_MODEL]: "success",
    },
  });

  const session = await harness.post("/v1/chat/sessions", { provider: "auto" });
  const message = await harness.post(`/v1/chat/sessions/${session.json.session_id}/messages`, {
    role: "user",
    content: "client-error",
  });

  assert.equal(message.res.status, 401);

  const stats = await harness.get("/v1/test/provider-stats");
  assert.ok(stats.json.calls[PRIMARY_MODEL] > 0);
  assert.equal(stats.json.calls[SECONDARY_MODEL], undefined);
});

integrationTest("429 hard-disables model for subsequent requests", async () => {
  await harness.post("/v1/test/reset");
  await harness.post("/v1/test/provider-behavior", {
    behaviors: {
      [PRIMARY_MODEL]: "rate_limited",
      [SECONDARY_MODEL]: "success",
    },
  });

  const session = await harness.post("/v1/chat/sessions", { provider: "auto" });
  await harness.post(`/v1/chat/sessions/${session.json.session_id}/messages`, {
    role: "user",
    content: "rate-limit",
  });

  const statsAfterFirst = await harness.get("/v1/test/provider-stats");
  const countFirst = statsAfterFirst.json.calls[PRIMARY_MODEL] || 0;

  const next = await harness.post(`/v1/chat/sessions/${session.json.session_id}/messages`, {
    role: "user",
    content: "next",
  });

  assert.equal(next.res.status, 200);

  const statsAfterSecond = await harness.get("/v1/test/provider-stats");
  const countSecond = statsAfterSecond.json.calls[PRIMARY_MODEL] || 0;
  assert.equal(countSecond, countFirst);
});

integrationTest("availability is global across sessions", async () => {
  await harness.post("/v1/test/reset");
  await harness.post("/v1/test/provider-behavior", {
    behaviors: {
      [PRIMARY_MODEL]: "server_error",
      [SECONDARY_MODEL]: "success",
    },
  });

  const s1 = await harness.post("/v1/chat/sessions", { provider: "auto" });
  await harness.post(`/v1/chat/sessions/${s1.json.session_id}/messages`, { role: "user", content: "x1" });
  await harness.post(`/v1/chat/sessions/${s1.json.session_id}/messages`, { role: "user", content: "x2" });

  const statsBefore = await harness.get("/v1/test/provider-stats");
  const countBefore = statsBefore.json.calls[PRIMARY_MODEL] || 0;

  const s2 = await harness.post("/v1/chat/sessions", { provider: "auto" });
  const m2 = await harness.post(`/v1/chat/sessions/${s2.json.session_id}/messages`, { role: "user", content: "x3" });

  assert.equal(m2.res.status, 200);

  const statsAfter = await harness.get("/v1/test/provider-stats");
  const countAfter = statsAfter.json.calls[PRIMARY_MODEL] || 0;
  assert.equal(countAfter, countBefore);
});

integrationTest("records model-specific prompt root per request", async () => {
  await harness.post("/v1/test/reset");
  await harness.post("/v1/test/provider-behavior", {
    behaviors: {
      [PRIMARY_MODEL]: "rate_limited",
      [SECONDARY_MODEL]: "success",
    },
  });

  const session = await harness.post("/v1/chat/sessions", { provider: "auto" });
  const message = await harness.post(`/v1/chat/sessions/${session.json.session_id}/messages`, {
    role: "user",
    content: "prompt-root",
  });

  assert.equal(message.res.status, 200);

  const promptRoot = await harness.get(`/v1/test/prompt-root?request_id=${message.json.tool_trace_id}`);
  assert.equal(promptRoot.res.status, 200);
  assert.equal(promptRoot.json.prompt_root, getPromptRootForModel({ modelId: SECONDARY_MODEL }));
});

integrationTest("response_format=combined omits follow_up_questions field", async () => {
  await harness.post("/v1/test/reset");

  const session = await harness.post("/v1/chat/sessions", { provider: "auto" });
  const message = await harness.post(`/v1/chat/sessions/${session.json.session_id}/messages`, {
    role: "user",
    content: "combined-format",
    response_format: "combined",
  });

  assert.equal(message.res.status, 200);
  assert.equal(typeof message.json.answer, "string");
  assert.equal("follow_up_questions" in message.json, false);
});
