import { test } from "node:test";
import assert from "node:assert/strict";

import { runKeywordFix } from "../../src/orchestrator/keyword_fix.js";

test("runKeywordFix uses Step1b prompt and parses JSON", async () => {
  let capturedPrompt = "";
  const provider = {
    completeJson: async ({ messages }) => {
      capturedPrompt = messages[1].content;
      return '{"language":"hi","workflow":"basic_question_v1","is_followup":false,"keywords":["आत्मा"],"filters":{}}';
    },
  };

  const result = await runKeywordFix({
    provider,
    question: "Atma kya hai?",
    step1Json: { language: "hi", workflow: "basic_question_v1", is_followup: false, keywords: ["आत्मा"], filters: {} },
    requestId: "r1",
  });

  assert.equal(result.workflow, "basic_question_v1");
  assert.ok(capturedPrompt.includes("Atma kya hai?"));
  assert.ok(capturedPrompt.includes("\"keywords\""));
});
