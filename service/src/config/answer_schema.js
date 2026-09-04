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

export const SUMMARY_ANSWER_SCHEMA = {
  type: "object",
  properties: {
    answer_status: {
      type: "string",
      enum: ["answered", "no_answer"],
    },
    // Array, not a plain string — one item per paragraph. This is what
    // actually keeps summary-mode answers from running into one wall of
    // text: the array shape is enforced by the provider's structured-output
    // decoding, unlike a prose style instruction the model can just ignore.
    // minItems is 1, not 2: a short no_answer explanation is often
    // genuinely one line, and forcing a second item there would be awkward.
    // server.js joins the array with "\n\n" right after parsing; nothing
    // downstream of that needs to know answer was ever anything but a string.
    answer: {
      type: "array",
      description:
        "The answer, split into paragraphs — one array item per paragraph. Start a new paragraph whenever the discussion moves to a new point, cause, contrast, or example. A short no_answer explanation can be a single item.",
      items: { type: "string" },
      minItems: 1,
    },
    citation_order: {
      type: "array",
      items: { type: "string" },
    },
    // A dedicated field, not a header phrase embedded in `answer` for the
    // server to regex back out — that approach (still used by
    // structured/combined) is exactly what broke: the prompt only gives the
    // model an English phrase to translate, so the Hindi wording varies
    // ("अगर आप चाहें" vs "यदि आप चाहें"), and the server's extraction regex
    // only recognized one of them. A schema field has no wording to match.
    follow_up_questions: {
      type: "array",
      items: { type: "string" },
      description:
        "2-3 relevant follow-up questions grounded in the context, unique and not repeating history questions. Empty array when answer_status is 'no_answer'.",
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
  required: ["answer_status", "answer", "citation_order", "follow_up_questions", "scoring"],
  additionalProperties: false,
};

export function getAnswerSchema({ workflowName = "", responseFormat = "combined" } = {}) {
  if (workflowName === "metadata_question_v1") return METADATA_ANSWER_SCHEMA;
  if (responseFormat === "summary") return SUMMARY_ANSWER_SCHEMA;
  return responseFormat === "combined" ? COMBINED_ANSWER_SCHEMA : ANSWER_SCHEMA;
}
