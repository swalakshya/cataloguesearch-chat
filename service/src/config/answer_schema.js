export const ANSWER_SCHEMA = {
  type: "object",
  properties: {
    answer_status: {
      type: "string",
      enum: ["answered", "no_answer"],
    },
    answer: { type: "string" },
    scoring: {
      type: "array",
      items: {
        type: "object",
        properties: {
          chunk_id: { type: "string" },
          score: { type: "integer" },
        },
        required: ["chunk_id", "score"],
        additionalProperties: false,
      },
    },
  },
  required: ["answer_status", "answer", "scoring"],
  additionalProperties: false,
};

export const COMBINED_ANSWER_SCHEMA = ANSWER_SCHEMA;

export const METADATA_ANSWER_SCHEMA = COMBINED_ANSWER_SCHEMA;

export function getAnswerSchema({ workflowName = "", responseFormat = "combined" } = {}) {
  if (workflowName === "metadata_question_v1") return METADATA_ANSWER_SCHEMA;
  return responseFormat === "combined" ? COMBINED_ANSWER_SCHEMA : ANSWER_SCHEMA;
}
