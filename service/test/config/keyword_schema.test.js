import { test } from "node:test";
import assert from "node:assert/strict";

import { KEYWORD_EXTRACTION_SCHEMA } from "../../src/config/keyword_schema.js";

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

test("keyword schema includes greeting workflow", () => {
  assert.ok(KEYWORD_EXTRACTION_SCHEMA.properties.workflow.enum.includes("greeting_message_v1"));
});

test("keyword schema accepts metadata_question_v1 with asked_info", () => {
  const askedInfo = KEYWORD_EXTRACTION_SCHEMA.properties.asked_info;
  assert.equal(askedInfo.type, "array");
  assert.equal(askedInfo.items.type, "string");
  assert.deepEqual(askedInfo.items.enum, ["granth", "anuyog", "author", "link"]);
  assert.ok(KEYWORD_EXTRACTION_SCHEMA.properties.workflow.enum.includes("metadata_question_v1"));
});
