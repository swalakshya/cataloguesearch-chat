import { test } from "node:test";
import assert from "node:assert/strict";

import { runAnswerSynthesis } from "../../src/orchestrator/answer_synthesis.js";
import { formatConversationHistory } from "../../src/orchestrator/conversation_history.js";
import { isPromptV2 } from "../../src/orchestrator/prompts.js";

test("runAnswerSynthesis injects conversation history and context", async () => {
  let capturedPrompt = "";
  let capturedSchema = null;
  const provider = {
    completeJson: async ({ messages, responseJsonSchema }) => {
      capturedPrompt = messages[1].content;
      capturedSchema = responseJsonSchema;
      return JSON.stringify({ answer: "answer", follow_up_questions: ["q1"], scoring: [] });
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
  assert.deepEqual(result.follow_up_questions, ["q1"]);
  assert.ok(capturedSchema.properties.follow_up_questions);
});

test("runAnswerSynthesis filters history by followupSetIds", async () => {
  let capturedPrompt = "";
  const provider = {
    completeJson: async ({ messages }) => {
      capturedPrompt = messages[1].content;
      return JSON.stringify({ answer: "answer", follow_up_questions: [], scoring: [] });
    },
  };

  await runAnswerSynthesis({
    provider,
    question: "Q?",
    workflowName: "followup_question_v1",
    context: "CTX",
    conversationHistory: [
      { id: "set_1", question: "Q1", answer: "A1" },
      { id: "set_2", question: "Q2", answer: "A2" },
    ],
    followupSetIds: ["set_2"],
    requestId: "r1",
  });

  const expectedHistory = formatConversationHistory(
    [{ id: "set_2", question: "Q2", answer: "A2" }],
    { includeChunkScores: false, includeAnswers: true, compact: isPromptV2() }
  );
  assert.ok(capturedPrompt.trim().endsWith(expectedHistory));
});

test("runAnswerSynthesis omits history when not followup", async () => {
  let capturedPrompt = "";
  const provider = {
    completeJson: async ({ messages }) => {
      capturedPrompt = messages[1].content;
      return JSON.stringify({ answer: "answer", follow_up_questions: [], scoring: [] });
    },
  };

  await runAnswerSynthesis({
    provider,
    question: "Q?",
    workflowName: "basic_question_v1",
    context: "CTX",
    conversationHistory: [],
    requestId: "r1",
  });

  assert.equal(capturedPrompt.includes("Conversation History"), false);
  assert.equal(capturedPrompt.includes("[]"), false);
});

test("runAnswerSynthesis repairs invalid JSON", async () => {
  let calls = 0;
  const provider = {
    completeJson: async () => {
      calls += 1;
      if (calls === 1) {
        return '{ "answer": "bad "json", "follow_up_questions": [], "scoring": [] }';
      }
      return JSON.stringify({ answer: "ok", follow_up_questions: ["q1", "q2"], scoring: [] });
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
  assert.deepEqual(result.follow_up_questions, ["q1", "q2"]);
});

test("runAnswerSynthesis falls back when repair fails", async () => {
  let calls = 0;
  const provider = {
    completeJson: async () => {
      calls += 1;
      return '{ "answer": "bad "json", "follow_up_questions": [], "scoring": [] }';
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
  assert.ok(typeof result.answer === "string");
  assert.deepEqual(result.follow_up_questions, []);
});

test("runAnswerSynthesis tolerates control characters", async () => {
  const provider = {
    completeJson: async () =>
      '{ "answer": "Line1\u2028Line2", "follow_up_questions": ["q1"], "scoring": [] }',
  };

  const result = await runAnswerSynthesis({
    provider,
    question: "Q?",
    workflowName: "basic_question_v1",
    context: "CTX",
    conversationHistory: [],
    requestId: "r1",
  });

  assert.equal(result.answer.includes("Line1"), true);
  assert.deepEqual(result.follow_up_questions, ["q1"]);
});

test("runAnswerSynthesis supports combined response format", async () => {
  let capturedPrompt = "";
  let capturedSchema = null;
  const provider = {
    completeJson: async ({ messages, responseJsonSchema }) => {
      capturedPrompt = messages[1].content;
      capturedSchema = responseJsonSchema;
      return JSON.stringify({ answer: "combined answer", scoring: [] });
    },
  };

  const result = await runAnswerSynthesis({
    provider,
    question: "Q?",
    workflowName: "basic_question_v1",
    context: "CTX",
    conversationHistory: [],
    requestId: "r1",
    responseFormat: "combined",
  });

  assert.equal(result.answer, "combined answer");
  assert.equal(result.follow_up_questions, undefined);
  assert.equal(capturedPrompt.includes('"follow_up_questions"'), false);
  assert.equal(capturedPrompt.includes("If you want I can answer this in detail or I can also answer"), true);
  assert.equal(capturedSchema.properties.follow_up_questions, undefined);
});
