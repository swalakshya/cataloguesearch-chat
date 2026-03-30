import { test } from "node:test";
import assert from "node:assert/strict";

import { KEYWORD_EXTRACTION_SCHEMA } from "../../src/orchestrator/keyword_schema.js";

test("keyword schema includes required fields and followup keyword objects", () => {
  assert.ok(KEYWORD_EXTRACTION_SCHEMA.required.includes("language"));
  assert.ok(KEYWORD_EXTRACTION_SCHEMA.required.includes("workflow"));
  assert.ok(KEYWORD_EXTRACTION_SCHEMA.required.includes("is_followup"));

  const followup = KEYWORD_EXTRACTION_SCHEMA.properties.followup_keywords;
  assert.equal(followup.type, "array");
  assert.equal(followup.items.type, "object");
  assert.ok(followup.items.required.includes("id"));
  assert.ok(followup.items.required.includes("keywords"));
});
