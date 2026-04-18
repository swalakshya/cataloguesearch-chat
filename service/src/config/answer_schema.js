export const ANSWER_SCHEMA = {
  type: "object",
  properties: {
    answer: { type: "string" },
    follow_up_questions: {
      type: "array",
      items: { type: "string" },
    },
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
  required: ["answer", "follow_up_questions", "scoring"],
  additionalProperties: false,
};

export const COMBINED_ANSWER_SCHEMA = {
  type: "object",
  properties: {
    answer: { type: "string" },
    scoring: ANSWER_SCHEMA.properties.scoring,
  },
  required: ["answer", "scoring"],
  additionalProperties: false,
};

export const METADATA_ANSWER_SCHEMA = COMBINED_ANSWER_SCHEMA;

export function getAnswerSchema({ workflowName = "", responseFormat = "structured" } = {}) {
  if (workflowName === "metadata_question_v1") return METADATA_ANSWER_SCHEMA;
  return responseFormat === "combined" ? COMBINED_ANSWER_SCHEMA : ANSWER_SCHEMA;
}
