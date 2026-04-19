import { test } from "node:test";
import assert from "node:assert/strict";

import { getWorkflowConfig, getWorkflowReferenceCount } from "../../src/config/workflow_config.js";
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

test("getWorkflowConfig includes referenceCount for each workflow", () => {
  const config = getWorkflowConfig("gemini-2.5-flash");
  assert.equal(config.basic.referenceCount, 2);
  assert.equal(config.followup.referenceCount, 5);
  assert.equal(config.advanced_distinct.referenceCount, 5);
  assert.equal(config.advanced_nested.referenceCount, 5);
});

test("getWorkflowReferenceCount returns correct count for known workflows", () => {
  assert.equal(getWorkflowReferenceCount("basic_question_v1", "gemini-2.5-flash"), 2);
  assert.equal(getWorkflowReferenceCount("followup_question_v1", "gemini-2.5-flash"), 5);
  assert.equal(getWorkflowReferenceCount("advanced_distinct_questions_v1", "gemini-2.5-flash"), 5);
  assert.equal(getWorkflowReferenceCount("advanced_nested_questions_v1", "gemini-2.5-flash"), 5);
});

test("getWorkflowReferenceCount returns undefined for unknown workflow", () => {
  assert.equal(getWorkflowReferenceCount("metadata_question_v1", "gemini-2.5-flash"), undefined);
  assert.equal(getWorkflowReferenceCount("unknown_workflow", "gemini-2.5-flash"), undefined);
});

test("getWorkflowReferenceCount respects per-model overrides", () => {
  const model = MODEL_ROUTING_CONFIG.models.find((entry) => entry.id === "gpt-4o");
  const previous = model.workflowOverrides;
  model.workflowOverrides = { basic: { referenceCount: 3 } };
  try {
    assert.equal(getWorkflowReferenceCount("basic_question_v1", "gpt-4o"), 3);
    // unoverridden workflow still uses default
    assert.equal(getWorkflowReferenceCount("followup_question_v1", "gpt-4o"), 5);
  } finally {
    model.workflowOverrides = previous;
  }
});
