import { test } from "node:test";
import assert from "node:assert/strict";

import { runAnswerSynthesis } from "../../src/orchestrator/answer_synthesis.js";

test("runAnswerSynthesis injects conversation history and context", async () => {
  let capturedPrompt = "";
  const provider = {
    completeJson: async ({ messages }) => {
      capturedPrompt = messages[1].content;
      return JSON.stringify({ answer: "answer", scoring: [] });
    },
  };

  const result = await runAnswerSynthesis({
    provider,
    question: "Q?",
    workflowName: "basic_question_v1",
    context: "CTX",
    conversationHistory: [{ id: "set_1", question: "Q1", answer: "A1", chunk_ids: ["c1"] }],
    requestId: "r1",
  });

  assert.ok(capturedPrompt.includes("Q?"));
  assert.ok(capturedPrompt.includes("CTX"));
  assert.ok(capturedPrompt.includes("\"set_1\""));
  assert.equal(result.answer, "answer");
});

test("runAnswerSynthesis repairs invalid JSON", async () => {
  let calls = 0;
  const provider = {
    completeJson: async () => {
      calls += 1;
      if (calls === 1) {
        return '{ "answer": "bad "json", "scoring": [] }';
      }
      return JSON.stringify({ answer: "ok", scoring: [] });
    },
  };

  const result = await runAnswerSynthesis({
    provider,
    question: "Q?",
    workflowName: "basic_question_v1",
    context: "CTX",
    conversationHistory: [],
    requestId: "r1",
  });

  assert.equal(calls, 2);
  assert.equal(result.answer, "ok");
});
