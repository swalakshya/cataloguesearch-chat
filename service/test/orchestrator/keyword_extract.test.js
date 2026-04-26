import { test } from "node:test";
import assert from "node:assert/strict";

import { runKeywordExtraction } from "../../src/orchestrator/keyword_extract.js";

test("runKeywordExtraction injects conversation history and parses JSON block", async () => {
  let capturedPrompt = "";
  let capturedSchema = null;
  const provider = {
    completeJson: async ({ messages, responseJsonSchema }) => {
      capturedPrompt = messages[1].content;
      capturedSchema = responseJsonSchema;
      return {
        text: [
          "Some text before",
          '{"language":"hi","workflow":"basic_question_v1","is_followup":false,"keywords":["आत्मा"],"filters":{}}',
          "Some text after",
        ].join("\n"),
        usage_normalized: {},
      };
    },
  };

  const result = await runKeywordExtraction({
    provider,
    question: "What is Atma?",
    sessionContext: {
      conversationHistory: [{ id: "set_1", question: "Q1", answer: "A1", chunk_ids: ["c1"] }],
    },
    requestId: "r1",
  });

  assert.equal(result.workflow, "basic_question_v1");
  assert.ok(capturedPrompt.includes("\"set_1\""));
});

test("runKeywordExtraction uses GUJ schema when gujChunks=true", async () => {
  let capturedSchema = null;
  const provider = {
    completeJson: async ({ responseJsonSchema }) => {
      capturedSchema = responseJsonSchema;
      return {
        text: '{"language":"hi","workflow":"basic_question_v1","is_followup":false,"keywords":["आत्मा"],"keywords_guj":["આત્મા"],"filters":{}}',
        usage_normalized: {},
      };
    },
  };

  await runKeywordExtraction({
    provider,
    question: "What is Atma?",
    sessionContext: { conversationHistory: [] },
    requestId: "r1",
    gujChunks: true,
  });

  assert.ok(capturedSchema.required.includes("keywords_guj"));
});

test("runKeywordExtraction uses standard schema when gujChunks=false", async () => {
  let capturedSchema = null;
  const provider = {
    completeJson: async ({ responseJsonSchema }) => {
      capturedSchema = responseJsonSchema;
      return {
        text: '{"language":"hi","workflow":"basic_question_v1","is_followup":false,"keywords":["आत्मा"],"filters":{}}',
        usage_normalized: {},
      };
    },
  };

  await runKeywordExtraction({
    provider,
    question: "What is Atma?",
    sessionContext: { conversationHistory: [] },
    requestId: "r1",
    gujChunks: false,
  });

  assert.equal(capturedSchema.required.includes("keywords_guj"), false);
});
