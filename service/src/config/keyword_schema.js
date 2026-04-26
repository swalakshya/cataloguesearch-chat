// OpenAI strict mode requires ALL declared properties to be in `required[]`.
// Optional fields are expressed as nullable (type: ["<type>", "null"]) so the
// model can emit null when a field does not apply to the current workflow,
// while still satisfying the strict schema contract.
// Gemini ignores the nullable widening and continues to work as before.

// keywords_guj property definition reused across schema variants
const KEYWORDS_GUJ_PROP = {
  type: ["array", "null"],
  items: { type: "string" },
};

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
    is_followup: { type: "boolean" },
    asked_info: {
      type: ["array", "null"],
      items: { type: "string", enum: ["granth", "anuyog", "author", "link"] },
    },
    keywords: {
      type: ["array", "null"],
      items: { type: "string" },
    },
    filters: {
      type: ["object", "null"],
      properties: {
        granth: { type: ["string", "null"] },
        anuyog: { type: ["string", "null"] },
        contributor: { type: ["string", "null"] },
        content_type: { type: ["array", "null"], items: { type: "string" } },
      },
      required: ["granth", "anuyog", "contributor", "content_type"],
      additionalProperties: false,
    },
    followup_keywords: {
      type: ["array", "null"],
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
      type: ["array", "null"],
      items: { type: "string" },
    },
    queries: {
      type: ["array", "null"],
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
      type: ["object", "null"],
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
      type: ["array", "null"],
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
  required: [
    "language",
    "workflow",
    "is_followup",
    "asked_info",
    "keywords",
    "filters",
    "followup_keywords",
    "expand_chunk_ids",
    "queries",
    "main_query",
    "sub_queries",
  ],
  additionalProperties: false,
};

// Extended schema for Gujarati search mode — mirrors KEYWORD_EXTRACTION_SCHEMA
// but adds keywords_guj to every keyword-bearing object so the LLM outputs
// Gujarati translations alongside Hindi keywords.
export const KEYWORD_EXTRACTION_SCHEMA_GUJ_SEARCH = {
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
    is_followup: { type: "boolean" },
    asked_info: {
      type: ["array", "null"],
      items: { type: "string", enum: ["granth", "anuyog", "author", "link"] },
    },
    keywords: {
      type: ["array", "null"],
      items: { type: "string" },
    },
    keywords_guj: KEYWORDS_GUJ_PROP,
    filters: {
      type: ["object", "null"],
      properties: {
        granth: { type: ["string", "null"] },
        anuyog: { type: ["string", "null"] },
        contributor: { type: ["string", "null"] },
        content_type: { type: ["array", "null"], items: { type: "string" } },
      },
      required: ["granth", "anuyog", "contributor", "content_type"],
      additionalProperties: false,
    },
    followup_keywords: {
      type: ["array", "null"],
      items: {
        type: "object",
        properties: {
          id: { type: "string" },
          keywords: {
            type: "array",
            items: { type: "string" },
          },
          keywords_guj: KEYWORDS_GUJ_PROP,
        },
        required: ["id", "keywords", "keywords_guj"],
        additionalProperties: false,
      },
    },
    expand_chunk_ids: {
      type: ["array", "null"],
      items: { type: "string" },
    },
    queries: {
      type: ["array", "null"],
      items: {
        type: "object",
        properties: {
          id: { type: "string" },
          keywords: {
            type: "array",
            items: { type: "string" },
          },
          keywords_guj: KEYWORDS_GUJ_PROP,
        },
        required: ["id", "keywords", "keywords_guj"],
        additionalProperties: false,
      },
    },
    main_query: {
      type: ["object", "null"],
      properties: {
        keywords: {
          type: "array",
          items: { type: "string" },
        },
        keywords_guj: KEYWORDS_GUJ_PROP,
      },
      required: ["keywords", "keywords_guj"],
      additionalProperties: false,
    },
    sub_queries: {
      type: ["array", "null"],
      items: {
        type: "object",
        properties: {
          id: { type: "string" },
          keywords: {
            type: "array",
            items: { type: "string" },
          },
          keywords_guj: KEYWORDS_GUJ_PROP,
        },
        required: ["id", "keywords", "keywords_guj"],
        additionalProperties: false,
      },
    },
  },
  required: [
    "language",
    "workflow",
    "is_followup",
    "asked_info",
    "keywords",
    "keywords_guj",
    "filters",
    "followup_keywords",
    "expand_chunk_ids",
    "queries",
    "main_query",
    "sub_queries",
  ],
  additionalProperties: false,
};
