import { test } from "node:test";
import assert from "node:assert/strict";

import { ANSWER_SCHEMA } from "../../src/config/answer_schema.js";

test("ANSWER_SCHEMA requires structured follow up questions", () => {
  assert.equal(ANSWER_SCHEMA.type, "object");
  assert.ok(ANSWER_SCHEMA.properties.follow_up_questions);
  assert.equal(ANSWER_SCHEMA.properties.follow_up_questions.type, "array");
  assert.deepEqual(ANSWER_SCHEMA.properties.follow_up_questions.items, { type: "string" });
  assert.ok(ANSWER_SCHEMA.required.includes("follow_up_questions"));
});
