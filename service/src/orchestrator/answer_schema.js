export const ANSWER_SCHEMA = {
  type: "object",
  properties: {
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
  required: ["answer", "scoring"],
  additionalProperties: false,
};
