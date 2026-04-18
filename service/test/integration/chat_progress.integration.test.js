import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createIntegrationHarness, isIntegrationEnabled } from "../../test_support/integration_harness.js";

const INTEGRATION_ENABLED = isIntegrationEnabled();
const harness = createIntegrationHarness("chat-progress");

before(async () => {
  if (!INTEGRATION_ENABLED) return;
  await harness.start();
});

after(async () => {
  if (!INTEGRATION_ENABLED) return;
  await harness.stop();
});

const integrationTest = INTEGRATION_ENABLED ? test : test.skip;

integrationTest("structured chat stream emits progress stages before final response", async () => {
  await harness.reset();
  const session = await harness.post("/v1/chat/sessions", { provider: "auto" });
  const sessionId = session.json.session_id;

  const stream = await harness.postStream(`/v1/chat/sessions/${sessionId}/messages/stream`, {
    role: "user",
    content: "What is Atma?",
    response_format: "structured",
  });
  assert.equal(stream.res.ok, true);
  const { events } = stream;

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
