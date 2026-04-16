import { test } from "node:test";
import assert from "node:assert/strict";

import {
  getAllowedContentTypes,
  getDefaultContentTypes,
  hasSameContentTypes,
  normalizeContentTypes,
  parseContentTypes,
  sanitizeAllowedContentTypes,
} from "../../src/config/content_types.js";

test("parseContentTypes trims and dedupes comma-separated strings", () => {
  assert.deepEqual(parseContentTypes("Pravachan, Granth, Pravachan"), ["Pravachan", "Granth"]);
});

test("getDefaultContentTypes reads env override", () => {
  assert.deepEqual(
    getDefaultContentTypes({ LLM_DEFAULT_CONTENT_TYPES: "Pravachan,Granth" }),
    ["Pravachan", "Granth"]
  );
});

test("normalizeContentTypes falls back to configured defaults", () => {
  assert.deepEqual(
    normalizeContentTypes(undefined, {
      env: { LLM_DEFAULT_CONTENT_TYPES: "Pravachan,Granth" },
    }),
    ["Pravachan", "Granth"]
  );
});

test("getAllowedContentTypes reads env override", () => {
  assert.deepEqual(
    getAllowedContentTypes({ LLM_ALLOWED_CONTENT_TYPES: "Pravachan,Granth,Books" }),
    ["Pravachan", "Granth", "Books"]
  );
});

test("sanitizeAllowedContentTypes filters unsupported values", () => {
  assert.deepEqual(
    sanitizeAllowedContentTypes(["Pravachan", "Audio"], {
      env: {
        LLM_DEFAULT_CONTENT_TYPES: "Pravachan,Granth",
        LLM_ALLOWED_CONTENT_TYPES: "Pravachan,Granth,Books",
      },
      fallbackToDefault: false,
    }),
    ["Pravachan"]
  );
});

test("hasSameContentTypes compares lists ignoring order", () => {
  assert.equal(hasSameContentTypes(["Pravachan", "Granth"], ["Granth", "Pravachan"]), true);
});

test("getDefaultContentTypes warns on invalid configured env value", () => {
  const originalLog = console.log;
  const messages = [];
  console.log = (value) => messages.push(String(value));

  try {
    const contentTypes = getDefaultContentTypes({ LLM_DEFAULT_CONTENT_TYPES: " , , " });
    assert.deepEqual(contentTypes, ["Granth", "Books"]);
  } finally {
    console.log = originalLog;
  }

  assert.equal(messages.some((entry) => entry.includes("\"message\":\"content_types_env_invalid\"")), true);
});
