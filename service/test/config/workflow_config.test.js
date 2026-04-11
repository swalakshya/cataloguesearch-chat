import { test } from "node:test";
import assert from "node:assert/strict";

import { getWorkflowConfig } from "../../src/config/workflow_config.js";
import { MODEL_ROUTING_CONFIG } from "../../src/config/model_config.js";

test("getWorkflowConfig returns defaults when no overrides", () => {
  const config = getWorkflowConfig("gemini-2.5-flash");
  assert.equal(config.basic.page, 1);
  assert.equal(config.basic.page_size, 15);
  assert.equal(config.basic.rerank, true);
  assert.equal(config.followup.expand_limit, 10);
});

test("getWorkflowConfig applies per-model overrides", () => {
  const model = MODEL_ROUTING_CONFIG.models.find((entry) => entry.id === "gpt-4o");
  const previous = model.workflowOverrides;
  model.workflowOverrides = { followup: { expand_limit: 5 } };
  try {
    const config = getWorkflowConfig("gpt-4o");
    assert.equal(config.followup.expand_limit, 5);
    assert.equal(config.followup.navigate_steps, 3);
  } finally {
    model.workflowOverrides = previous;
  }
});
