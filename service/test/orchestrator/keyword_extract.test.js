import { test } from "node:test";
import assert from "node:assert/strict";

import { runKeywordExtraction } from "../../src/orchestrator/keyword_extract.js";

test("runKeywordExtraction injects conversation history and parses JSON block", async () => {
  let capturedPrompt = "";
  const provider = {
    completeJson: async ({ messages }) => {
      capturedPrompt = messages[1].content;
      return [
        "Some text before",
        '{"language":"hi","workflow":"basic_question_v1","is_followup":false,"keywords":["आत्मा"],"filters":{}}',
        "Some text after",
      ].join("\n");
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
