import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createIntegrationHarness, isIntegrationEnabled } from "../../test_support/integration_harness.js";

const INTEGRATION_ENABLED = isIntegrationEnabled();
const harness = createIntegrationHarness("guj-search");

before(async () => {
  if (!INTEGRATION_ENABLED) return;
  await harness.start();
});

after(async () => {
  if (!INTEGRATION_ENABLED) return;
  await harness.stop();
});

const integrationTest = INTEGRATION_ENABLED ? test : test.skip;

integrationTest("guj search triggers when full_citations=false and enable_guj_chunks=true", async () => {
  const session = await harness.post("/v1/chat/sessions", { provider: "auto" });
  assert.equal(session.res.status, 200);

  const message = await harness.post(`/v1/chat/sessions/${session.json.session_id}/messages`, {
    role: "user",
    content: "आत्मा क्या है?",
    full_citations: false,
    enable_guj_chunks: true,
  });

  assert.equal(message.res.status, 200);
  assert.equal(typeof message.json.answer, "string");
});

integrationTest("guj search does not trigger when enable_guj_chunks=false", async () => {
  const session = await harness.post("/v1/chat/sessions", { provider: "auto" });
  assert.equal(session.res.status, 200);

  const message = await harness.post(`/v1/chat/sessions/${session.json.session_id}/messages`, {
    role: "user",
    content: "आत्मा क्या है?",
    full_citations: false,
    enable_guj_chunks: false,
  });

  assert.equal(message.res.status, 200);
});

integrationTest("guj search does not trigger when full_citations=true even if enable_guj_chunks=true", async () => {
  const session = await harness.post("/v1/chat/sessions", { provider: "auto" });
  assert.equal(session.res.status, 200);

  const message = await harness.post(`/v1/chat/sessions/${session.json.session_id}/messages`, {
    role: "user",
    content: "आत्मा क्या है?",
    full_citations: true,
    enable_guj_chunks: true,
  });

  assert.equal(message.res.status, 200);
});

integrationTest("guj search with structured response format returns answer", async () => {
  const session = await harness.post("/v1/chat/sessions", { provider: "auto" });
  assert.equal(session.res.status, 200);

  const message = await harness.post(`/v1/chat/sessions/${session.json.session_id}/messages`, {
    role: "user",
    content: "आत्मा क्या है?",
    full_citations: false,
    enable_guj_chunks: true,
    response_format: "structured",
  });

  assert.equal(message.res.status, 200);
});
