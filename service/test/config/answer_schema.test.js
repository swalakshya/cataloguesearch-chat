import { test } from "node:test";
import assert from "node:assert/strict";

import {
  ANSWER_SCHEMA,
  COMBINED_ANSWER_SCHEMA,
  getAnswerSchema,
} from "../../src/config/answer_schema.js";

test("ANSWER_SCHEMA requires structured follow up questions", () => {
  assert.equal(ANSWER_SCHEMA.type, "object");
  assert.ok(ANSWER_SCHEMA.properties.follow_up_questions);
  assert.equal(ANSWER_SCHEMA.properties.follow_up_questions.type, "array");
  assert.deepEqual(ANSWER_SCHEMA.properties.follow_up_questions.items, { type: "string" });
  assert.ok(ANSWER_SCHEMA.required.includes("follow_up_questions"));
});

test("COMBINED_ANSWER_SCHEMA omits follow up questions", () => {
  assert.equal(COMBINED_ANSWER_SCHEMA.type, "object");
  assert.equal(COMBINED_ANSWER_SCHEMA.properties.follow_up_questions, undefined);
  assert.deepEqual(COMBINED_ANSWER_SCHEMA.required, ["answer", "scoring"]);
});

test("getAnswerSchema selects schema by response format and workflow", () => {
  assert.equal(getAnswerSchema({ responseFormat: "structured" }), ANSWER_SCHEMA);
  assert.equal(getAnswerSchema({ responseFormat: "combined" }), COMBINED_ANSWER_SCHEMA);
  assert.equal(
    getAnswerSchema({ workflowName: "metadata_question_v1", responseFormat: "structured" }),
    COMBINED_ANSWER_SCHEMA
  );
});
