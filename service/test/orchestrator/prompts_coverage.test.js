import { test } from "node:test";
import assert from "node:assert/strict";

import { getWorkflowGuidelines } from "../../src/orchestrator/prompts.js";

test("getWorkflowGuidelines returns content for known workflows", () => {
  const text = getWorkflowGuidelines("basic_question_v1");
  assert.ok(text.length > 0);
});
