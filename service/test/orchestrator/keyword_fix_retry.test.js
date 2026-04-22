import { test } from "node:test";
import assert from "node:assert/strict";

import { retryWorkflowOnEmptyChunks } from "../../src/orchestrator/keyword_fix_retry.js";

test("retryWorkflowOnEmptyChunks reruns workflow once when chunks are empty", async () => {
  const calls = { fix: 0, workflow: 0 };
  const runWorkflowFn = async ({ keywordResult, modelId }) => {
    assert.equal(modelId, "gemini-2.5-flash");
    calls.workflow += 1;
    if (calls.workflow === 1) return { workflowName: "basic_question_v1", chunks: [], toolCallsUsed: 2 };
    return { workflowName: "basic_question_v1", chunks: [{ id: "c1" }], toolCallsUsed: 3 };
  };
  const runKeywordFixFn = async () => {
    calls.fix += 1;
    return { language: "hi", workflow: "basic_question_v1", is_followup: false, keywords: ["आत्मा"], filters: {} };
  };

  const result = await retryWorkflowOnEmptyChunks({
    initialKeywordResult: { workflow: "basic_question_v1" },
    question: "Atma kya hai?",
    requestId: "r1",
    provider: {},
    externalApi: {},
    modelId: "gemini-2.5-flash",
    runWorkflowFn,
    runKeywordFixFn,
  });

  assert.equal(calls.fix, 1);
  assert.equal(calls.workflow, 2);
  assert.equal(result.keywordFixApplied, true);
  assert.equal(result.chunks.length, 1);
  assert.equal(result.toolCallsUsed, 5);
});
