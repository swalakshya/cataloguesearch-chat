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
});

test("getAnswerPrompt uses category-neutral reference wording", () => {
  const prompt = getAnswerPrompt("Q?", "CTX", "", "", "basic_question_v1");
  assert.ok(prompt.includes("SourceNameOrCategory, Page N, file_url/N"));
});
