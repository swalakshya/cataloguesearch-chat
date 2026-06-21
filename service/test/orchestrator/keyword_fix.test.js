import { test } from "node:test";
import assert from "node:assert/strict";

import { runKeywordFix } from "../../src/orchestrator/keyword_fix.js";

test("runKeywordFix uses Step1b prompt and parses JSON", async () => {
  let capturedPrompt = "";
  const provider = {
    completeJson: async ({ messages }) => {
      capturedPrompt = messages[1].content;
      return { text: '{"language":"hi","workflow":"basic_question_v1","is_followup":false,"keywords":["आत्मा"],"filters":{}}', usage_normalized: {} };
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

test("runKeywordFix with missedWithSuggestions renders them in the prompt", async () => {
  let capturedPrompt = "";
  const provider = {
    completeJson: async ({ messages }) => {
      capturedPrompt = messages[1].content;
      return { text: '{"language":"hi","workflow":"basic_question_v1","is_followup":false,"keywords":["आत्मा"],"filters":{}}', usage_normalized: {} };
    },
  };

  await runKeywordFix({
    provider,
    question: "Atma kya hai?",
    step1Json: { language: "hi", workflow: "basic_question_v1", is_followup: false, keywords: ["आातम"], filters: {} },
    requestId: "r2",
    missedWithSuggestions: [
      { token: "आातम", suggestions: [{ kw: "आत्मा", similarity: 0.75 }, { kw: "आतमा", similarity: 0.50 }] },
    ],
  });

  assert.ok(capturedPrompt.includes("आातम"), "missed token should appear in prompt");
  assert.ok(capturedPrompt.includes("आत्मा"), "suggestion should appear in prompt");
  assert.ok(capturedPrompt.includes("0.75"), "similarity score should appear in prompt");
});

test("runKeywordFix without missedWithSuggestions renders (none) in prompt", async () => {
  let capturedPrompt = "";
  const provider = {
    completeJson: async ({ messages }) => {
      capturedPrompt = messages[1].content;
      return { text: '{"language":"hi","workflow":"basic_question_v1","is_followup":false,"keywords":["आत्मा"],"filters":{}}', usage_normalized: {} };
    },
  };

  await runKeywordFix({
    provider,
    question: "Atma kya hai?",
    step1Json: { language: "hi", workflow: "basic_question_v1", is_followup: false, keywords: ["आत्मा"], filters: {} },
    requestId: "r3",
  });

  assert.ok(capturedPrompt.includes("(none)"), "prompt should show (none) when no missed suggestions");
});
