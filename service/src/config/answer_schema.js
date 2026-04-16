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
