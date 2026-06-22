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

// Phase 1 (GraphRAG): Jain keyword classification fields
const JAIN_KEYWORDS_PROP = {
  type: ["array", "null"],
  items: { type: "string" },
};

const NORMAL_KEYWORDS_PROP = {
  type: ["array", "null"],
  items: { type: "string" },
};

// All possible sub-workflow fields merged into one schema; name enum gates which fields apply at runtime.
const KB_SUBWORKFLOW_ITEM_PROP = {
  type: "object",
  properties: {
    name: { type: "string", enum: ["direct_retrieval", "search_shastra_for_topics", "search_topic_in_shastra"] },
    shastra: { type: ["string", "null"] },
    gatha_number: { type: ["number", "null"] },
    adhikaar_number: { type: ["number", "null"] },
    topic: { type: ["string", "null"] },
    // direct_retrieval only: fetch the (Sanskrit) teeka commentary. Default/false
    // returns just mool verse + bhaavarth; set true only when the user explicitly
    // asks for the teeka/टीका.
    include_teeka: { type: ["boolean", "null"] },
  },
  required: ["name", "shastra", "gatha_number", "adhikaar_number", "topic", "include_teeka"],
  additionalProperties: false,
};

const KB_ENTITIES_PROP = {
  type: ["object", "null"],
  properties: {
    shastra_hints: { type: ["array", "null"], items: { type: "string" } },
    author_hints: { type: ["array", "null"], items: { type: "string" } },
  },
  required: ["shastra_hints", "author_hints"],
  additionalProperties: false,
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
    jain_keywords: JAIN_KEYWORDS_PROP,
    normal_keywords: NORMAL_KEYWORDS_PROP,
    kb_subworkflows: { type: ["array", "null"], items: KB_SUBWORKFLOW_ITEM_PROP },
    direct_retrieval_only: { type: ["boolean", "null"] },
    kb_entities: KB_ENTITIES_PROP,
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
    "jain_keywords",
    "normal_keywords",
    "kb_subworkflows",
    "direct_retrieval_only",
    "kb_entities",
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
    jain_keywords: JAIN_KEYWORDS_PROP,
    normal_keywords: NORMAL_KEYWORDS_PROP,
    kb_subworkflows: { type: ["array", "null"], items: KB_SUBWORKFLOW_ITEM_PROP },
    direct_retrieval_only: { type: ["boolean", "null"] },
    kb_entities: KB_ENTITIES_PROP,
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
    "jain_keywords",
    "normal_keywords",
    "kb_subworkflows",
    "direct_retrieval_only",
    "kb_entities",
    "filters",
    "followup_keywords",
    "expand_chunk_ids",
    "queries",
    "main_query",
    "sub_queries",
  ],
  additionalProperties: false,
};
