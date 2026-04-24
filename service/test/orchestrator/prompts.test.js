import { test } from "node:test";
import assert from "node:assert/strict";

import { getKeywordPrompt, getAnswerPrompt } from "../../src/orchestrator/prompts.js";

test("getKeywordPrompt injects conversation history", () => {
  const prompt = getKeywordPrompt("What is Atma?", '[{"id":"set_1"}]');
  assert.ok(prompt.includes("What is Atma?"));
  assert.ok(prompt.includes("Conversation History"));
  assert.ok(prompt.includes('[{"id":"set_1"}]'));
  assert.equal(prompt.includes("<CONVERSATION_HISTORY_HERE>"), false);
  assert.ok(prompt.trim().endsWith('[{"id":"set_1"}]'));
});

test("getKeywordPrompt injects configured content type defaults", () => {
  const prompt = getKeywordPrompt("What is Atma?", "[]", {
    env: {
      LLM_DEFAULT_CONTENT_TYPES: "Pravachan,Granth",
      LLM_ALLOWED_CONTENT_TYPES: "Pravachan,Granth,Books",
    },
  });
  assert.ok(prompt.includes('"content_type": ["Pravachan","Granth"]'));
  assert.ok(prompt.includes('allowed values: ["Pravachan","Granth","Books"]'));
});

test("getKeywordPrompt interpolation cache respects env changes", () => {
  const promptA = getKeywordPrompt("What is Atma?", "[]", {
    env: {
      LLM_DEFAULT_CONTENT_TYPES: "Pravachan,Granth",
      LLM_ALLOWED_CONTENT_TYPES: "Pravachan,Granth,Books",
    },
  });
  const promptB = getKeywordPrompt("What is Atma?", "[]", {
    env: {
      LLM_DEFAULT_CONTENT_TYPES: "Granth,Books",
      LLM_ALLOWED_CONTENT_TYPES: "Pravachan,Granth,Books",
    },
  });

  assert.ok(promptA.includes('"content_type": ["Pravachan","Granth"]'));
  assert.ok(promptB.includes('"content_type": ["Granth","Books"]'));
});

test("getAnswerPrompt injects conversation history and context", () => {
  const prompt = getAnswerPrompt("Q?", "CTX", "GUIDE", '[{"id":"set_2"}]', "basic_question_v1");
  assert.ok(prompt.includes("Q?"));
  assert.ok(prompt.includes("CTX"));
  assert.ok(prompt.includes("Conversation History"));
  assert.ok(prompt.includes('[{"id":"set_2"}]'));
  assert.equal(prompt.includes("<CONVERSATION_HISTORY_HERE>"), false);
  assert.equal(prompt.includes("<CONTEXT_HERE>"), false);
  assert.ok(prompt.trim().endsWith('[{"id":"set_2"}]'));
});

test("getAnswerPrompt appends history at the end when provided", () => {
  const history = '[{"id":"set_2"}]';
  const prompt = getAnswerPrompt("Q?", "CTX", "GUIDE", history, "basic_question_v1");
  assert.ok(prompt.trim().endsWith(history));
});

test("getAnswerPrompt omits history when empty", () => {
  const prompt = getAnswerPrompt("Q?", "CTX", "GUIDE", "", "basic_question_v1");
  assert.equal(prompt.includes("Conversation History"), false);
});

test("getAnswerPrompt uses metadata base prompt", () => {
  const prompt = getAnswerPrompt("Q?", "CTX", "", "[]", "metadata_question_v1");
  assert.ok(prompt.includes("Metadata Answer Synthesis"));
  assert.ok(prompt.includes("answer_status"));
});

test("getAnswerPrompt uses follow-up section in answer text for structured format", () => {
  const prompt = getAnswerPrompt("Q?", "CTX", "", "", "basic_question_v1");
  assert.equal(prompt.includes('"follow_up_questions": ["<question 1>", "<question 2>"]'), false);
  assert.ok(prompt.includes("If you want I can answer this in detail or I can also answer"));
  assert.ok(prompt.includes('"answer_status": "answered"'));
  assert.ok(prompt.includes("only when `answer_status` is `answered`"));
  assert.ok(prompt.includes("<full answer text including citations and follow-ups>"));
});

test("getAnswerPrompt uses combined answer template when requested", () => {
  const prompt = getAnswerPrompt("Q?", "CTX", "", "", "basic_question_v1", "", "", {
    responseFormat: "combined",
  });
  assert.equal(prompt.includes('"follow_up_questions": ["<question 1>", "<question 2>"]'), false);
  assert.ok(prompt.includes("If you want I can answer this in detail or I can also answer"));
  assert.ok(prompt.includes('"answer_status": "answered"'));
  assert.ok(prompt.includes("only when `answer_status` is `answered`"));
  assert.ok(prompt.includes("<full answer text including citations and follow-ups>"));
});

test("getAnswerPrompt uses full citations prompt when fullCitations=true in options", () => {
  const prompt = getAnswerPrompt("Q?", "CTX", "", "", "basic_question_v1", "", "", {
    fullCitations: true,
  });
  assert.ok(prompt.includes("do NOT write the actual quote text yourself"));
  assert.ok(prompt.includes('"answer_status": "answered"'));
  assert.ok(prompt.includes("only for chunks that directly support the final answer"));
});

test("getAnswerPrompt uses standard prompt when fullCitations=false even if env var is true", () => {
  const original = process.env.ENABLE_FULL_CHUNKS_IN_CITATIONS;
  process.env.ENABLE_FULL_CHUNKS_IN_CITATIONS = "true";
  try {
    const prompt = getAnswerPrompt("Q?", "CTX", "", "", "basic_question_v1", "", "", {
      fullCitations: false,
    });
    assert.equal(prompt.includes("do NOT write the actual quote text yourself"), false);
  } finally {
    if (original === undefined) delete process.env.ENABLE_FULL_CHUNKS_IN_CITATIONS;
    else process.env.ENABLE_FULL_CHUNKS_IN_CITATIONS = original;
  }
});

test("getAnswerPrompt falls back to env var when fullCitations not in options", () => {
  const original = process.env.ENABLE_FULL_CHUNKS_IN_CITATIONS;
  process.env.ENABLE_FULL_CHUNKS_IN_CITATIONS = "true";
  try {
    const prompt = getAnswerPrompt("Q?", "CTX", "", "", "basic_question_v1");
    assert.ok(prompt.includes("do NOT write the actual quote text yourself"));
  } finally {
    if (original === undefined) delete process.env.ENABLE_FULL_CHUNKS_IN_CITATIONS;
    else process.env.ENABLE_FULL_CHUNKS_IN_CITATIONS = original;
  }
});

test("getAnswerPrompt defaults to standard prompt when fullCitations not set and env var not set", () => {
  const original = process.env.ENABLE_FULL_CHUNKS_IN_CITATIONS;
  delete process.env.ENABLE_FULL_CHUNKS_IN_CITATIONS;
  try {
    const prompt = getAnswerPrompt("Q?", "CTX", "", "", "basic_question_v1");
    assert.equal(prompt.includes("do NOT write the actual quote text yourself"), false);
  } finally {
    if (original !== undefined) process.env.ENABLE_FULL_CHUNKS_IN_CITATIONS = original;
  }
});
