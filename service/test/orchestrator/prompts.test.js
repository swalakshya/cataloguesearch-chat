import { test } from "node:test";
import assert from "node:assert/strict";

import { getKeywordPrompt, getAnswerPrompt } from "../../src/orchestrator/prompts.js";

test("getKeywordPrompt injects conversation history", () => {
  const prompt = getKeywordPrompt("What is Atma?", '[{"id":"set_1"}]');
  assert.ok(prompt.includes("What is Atma?"));
  assert.ok(prompt.includes('[{"id":"set_1"}]'));
  assert.equal(prompt.includes("<CONVERSATION_HISTORY_HERE>"), false);
});

test("getAnswerPrompt injects conversation history and context", () => {
  const prompt = getAnswerPrompt("Q?", "CTX", "GUIDE", '[{"id":"set_2"}]');
  assert.ok(prompt.includes("Q?"));
  assert.ok(prompt.includes("CTX"));
  assert.ok(prompt.includes('[{"id":"set_2"}]'));
  assert.equal(prompt.includes("<CONVERSATION_HISTORY_HERE>"), false);
  assert.equal(prompt.includes("<CONTEXT_HERE>"), false);
});
