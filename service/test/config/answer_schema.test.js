import { test } from "node:test";
import assert from "node:assert/strict";

import {
  ANSWER_SCHEMA,
  COMBINED_ANSWER_SCHEMA,
  getAnswerSchema,
} from "../../src/config/answer_schema.js";

test("ANSWER_SCHEMA requires answer and scoring, no follow_up_questions", () => {
  assert.equal(ANSWER_SCHEMA.type, "object");
  assert.equal(ANSWER_SCHEMA.properties.follow_up_questions, undefined);
  assert.deepEqual(ANSWER_SCHEMA.required, ["answer", "scoring"]);
});

test("COMBINED_ANSWER_SCHEMA is the same as ANSWER_SCHEMA", () => {
  assert.equal(COMBINED_ANSWER_SCHEMA, ANSWER_SCHEMA);
});

test("getAnswerSchema returns the same schema for all formats", () => {
  assert.equal(getAnswerSchema({ responseFormat: "structured" }), ANSWER_SCHEMA);
  assert.equal(getAnswerSchema({ responseFormat: "combined" }), ANSWER_SCHEMA);
  assert.equal(
    getAnswerSchema({ workflowName: "metadata_question_v1", responseFormat: "combined" }),
    ANSWER_SCHEMA
  );
});
