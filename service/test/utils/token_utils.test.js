import { test } from "node:test";
import assert from "node:assert/strict";

import { estimateTokens, shouldRejectForTokenLimit, getSessionTokenLimit } from "../../src/utils/token.js";
import { DEFAULT_TOKEN_LIMITS } from "../../src/config/token_limits.js";

test("estimateTokens uses 4-char heuristic", () => {
  assert.equal(estimateTokens(""), 0);
  assert.equal(estimateTokens("abcd"), 1);
  assert.equal(estimateTokens("abcde"), 2);
});

test("shouldRejectForTokenLimit applies threshold", () => {
  const limit = 100;
  const threshold = 0.8;
  assert.equal(
    shouldRejectForTokenLimit({
      currentTokens: 79,
      incomingText: "abcd",
      limit,
      threshold,
    }),
    true
  );
  assert.equal(
    shouldRejectForTokenLimit({
      currentTokens: 10,
      incomingText: "abcd",
      limit,
      threshold,
    }),
    false
  );
});

test("getSessionTokenLimit reads env JSON map", () => {
  const env = {
    LLM_TOKEN_LIMITS_JSON: JSON.stringify({
      openai: { "gpt-4o": 128000, "*": 100000 },
      gemini: { "gemini-2.5-pro": 1048576 },
      default: { "*": 90000 },
    }),
  };
  assert.equal(getSessionTokenLimit("openai", "gpt-4o", env), 128000);
  assert.equal(getSessionTokenLimit("openai", "other", env), 100000);
  assert.equal(getSessionTokenLimit("gemini", "gemini-2.5-pro", env), 1048576);
  assert.equal(getSessionTokenLimit("unknown", "model", env), 90000);
});

test("getSessionTokenLimit falls back to defaults", () => {
  assert.equal(getSessionTokenLimit("openai", "gpt-4o", {}, DEFAULT_TOKEN_LIMITS), 128000);
  assert.equal(getSessionTokenLimit("unknown", "model", {}, DEFAULT_TOKEN_LIMITS), 120000);
});
