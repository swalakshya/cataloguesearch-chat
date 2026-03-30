import { test } from "node:test";
import assert from "node:assert/strict";

import { workflowRegistry } from "../../src/orchestrator/workflow_registry.js";

test("workflowRegistry exposes all workflows", () => {
  assert.equal(typeof workflowRegistry.basic_question_v1, "function");
  assert.equal(typeof workflowRegistry.followup_question_v1, "function");
  assert.equal(typeof workflowRegistry.advanced_distinct_questions_v1, "function");
  assert.equal(typeof workflowRegistry.advanced_nested_questions_v1, "function");
});
