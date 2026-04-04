export const KEYWORD_EXTRACTION_SCHEMA = {
  type: "object",
  properties: {
    language: { type: "string" },
    workflow: {
      type: "string",
      enum: [
        "basic_question_v1",
        "followup_question_v1",
        "advanced_distinct_questions_v1",
        "advanced_nested_questions_v1",
        "greeting_message_v1",
        "metadata_question_v1",
      ],
    },
    asked_info: {
      type: "array",
      items: { type: "string", enum: ["granth", "anuyog", "author", "link"] },
    },
    keywords: {
      type: "array",
      items: { type: "string" },
    },
    filters: {
      type: "object",
      properties: {
        granth: { type: "string" },
        anuyog: { type: "string" },
        contributor: { type: "string" },
        content_type: { type: "array", items: { type: "string", enum: ["Granth", "Books"] } },
      },
      additionalProperties: false,
    },
    is_followup: { type: "boolean" },
    followup_keywords: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: { type: "string" },
          keywords: {
            type: "array",
            items: { type: "string" },
          },
        },
        required: ["id", "keywords"],
        additionalProperties: false,
      },
    },
    expand_chunk_ids: {
      type: "array",
      items: { type: "string" },
    },
    queries: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: { type: "string" },
          keywords: {
            type: "array",
            items: { type: "string" },
          },
        },
        required: ["id", "keywords"],
        additionalProperties: false,
      },
    },
    main_query: {
      type: "object",
      properties: {
        keywords: {
          type: "array",
          items: { type: "string" },
        },
      },
      required: ["keywords"],
      additionalProperties: false,
    },
    sub_queries: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: { type: "string" },
          keywords: {
            type: "array",
            items: { type: "string" },
          },
        },
        required: ["id", "keywords"],
        additionalProperties: false,
      },
    },
  },
  required: ["language", "workflow", "is_followup"],
  additionalProperties: false,
};
