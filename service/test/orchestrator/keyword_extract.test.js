import { test } from "node:test";
import assert from "node:assert/strict";

import { runKeywordExtraction } from "../../src/orchestrator/keyword_extract.js";

test("runKeywordExtraction injects conversation history and parses JSON block", async () => {
  let capturedPrompt = "";
  let capturedSchema = null;
  const provider = {
    completeJson: async ({ messages, responseJsonSchema }) => {
      capturedPrompt = messages[1].content;
      capturedSchema = responseJsonSchema;
      return {
        text: [
          "Some text before",
          '{"language":"hi","workflow":"basic_question_v1","is_followup":false,"keywords":["आत्मा"],"filters":{}}',
          "Some text after",
        ].join("\n"),
        usage_normalized: {},
      };
    },
  };

  const result = await runKeywordExtraction({
    provider,
    question: "What is Atma?",
    sessionContext: {
      conversationHistory: [{ id: "set_1", question: "Q1", answer: "A1", chunk_ids: ["c1"] }],
    },
    requestId: "r1",
  });

  assert.equal(result.workflow, "basic_question_v1");
  assert.ok(capturedPrompt.includes("\"set_1\""));
});

test("runKeywordExtraction uses GUJ schema when gujChunks=true", async () => {
  let capturedSchema = null;
  const provider = {
    completeJson: async ({ responseJsonSchema }) => {
      capturedSchema = responseJsonSchema;
      return {
        text: '{"language":"hi","workflow":"basic_question_v1","is_followup":false,"keywords":["आत्मा"],"keywords_guj":["આત્મા"],"filters":{}}',
        usage_normalized: {},
      };
    },
  };

  await runKeywordExtraction({
    provider,
    question: "What is Atma?",
    sessionContext: { conversationHistory: [] },
    requestId: "r1",
    gujChunks: true,
  });

  assert.ok(capturedSchema.required.includes("keywords_guj"));
});

test("runKeywordExtraction uses standard schema when gujChunks=false", async () => {
  let capturedSchema = null;
  const provider = {
    completeJson: async ({ responseJsonSchema }) => {
      capturedSchema = responseJsonSchema;
      return {
        text: '{"language":"hi","workflow":"basic_question_v1","is_followup":false,"keywords":["आत्मा"],"filters":{}}',
        usage_normalized: {},
      };
    },
  };

  await runKeywordExtraction({
    provider,
    question: "What is Atma?",
    sessionContext: { conversationHistory: [] },
    requestId: "r1",
    gujChunks: false,
  });

  assert.equal(capturedSchema.required.includes("keywords_guj"), false);
});

// Phase 1 GraphRAG: Jain partition defaults and sub-workflow stripping

test("runKeywordExtraction applies Devanagari-default partition when LLM omits jain/normal_keywords", async () => {
  const provider = {
    completeJson: async () => ({
      text: '{"language":"hi","workflow":"basic_question_v1","is_followup":false,"keywords":["आत्मा","definition"],"filters":{}}',
      usage_normalized: {},
    }),
  };

  const result = await runKeywordExtraction({
    provider,
    question: "What is Atma?",
    sessionContext: { conversationHistory: [] },
    requestId: "r2",
  });

  assert.deepEqual(result.jain_keywords, ["आत्मा"]);
  assert.deepEqual(result.normal_keywords, ["definition"]);
});

test("runKeywordExtraction preserves LLM-provided jain/normal_keywords when both present", async () => {
  const provider = {
    completeJson: async () => ({
      text: JSON.stringify({
        language: "hi",
        workflow: "basic_question_v1",
        is_followup: false,
        keywords: ["आत्मा", "meaning"],
        jain_keywords: ["आत्मा"],
        normal_keywords: ["meaning"],
        filters: {},
      }),
      usage_normalized: {},
    }),
  };

  const result = await runKeywordExtraction({
    provider,
    question: "What is Atma?",
    sessionContext: { conversationHistory: [] },
    requestId: "r3",
  });

  assert.deepEqual(result.jain_keywords, ["आत्मा"]);
  assert.deepEqual(result.normal_keywords, ["meaning"]);
});

test("runKeywordExtraction strips unknown kb_subworkflow names", async () => {
  const provider = {
    completeJson: async () => ({
      text: JSON.stringify({
        language: "hi",
        workflow: "basic_question_v1",
        is_followup: false,
        keywords: ["आत्मा"],
        filters: {},
        kb_subworkflows: [
          { name: "direct_retrieval", shastra: "Samaysaar", gatha_number: 6, want: ["bhaavarth"], topic: null },
          { name: "unknown_workflow", shastra: null, gatha_number: null, want: null, topic: null },
        ],
      }),
      usage_normalized: {},
    }),
  };

  const result = await runKeywordExtraction({
    provider,
    question: "Samaysaar ki 6vi gatha batao",
    sessionContext: { conversationHistory: [] },
    requestId: "r4",
  });

  assert.equal(result.kb_subworkflows.length, 1);
  assert.equal(result.kb_subworkflows[0].name, "direct_retrieval");
});

test("runKeywordExtraction keeps all keywords as jain_keywords when all are Devanagari", async () => {
  const provider = {
    completeJson: async () => ({
      text: '{"language":"hi","workflow":"basic_question_v1","is_followup":false,"keywords":["आत्मा","मोक्ष","द्रव्य"],"filters":{}}',
      usage_normalized: {},
    }),
  };

  const result = await runKeywordExtraction({
    provider,
    question: "Atma moksha dravya kya hai?",
    sessionContext: { conversationHistory: [] },
    requestId: "r5",
  });

  assert.deepEqual(result.jain_keywords, ["आत्मा", "मोक्ष", "द्रव्य"]);
  assert.deepEqual(result.normal_keywords, []);
});

test("runKeywordExtraction keeps all keywords as normal_keywords when none are Devanagari", async () => {
  const provider = {
    completeJson: async () => ({
      text: '{"language":"en","workflow":"basic_question_v1","is_followup":false,"keywords":["soul","liberation"],"filters":{}}',
      usage_normalized: {},
    }),
  };

  const result = await runKeywordExtraction({
    provider,
    question: "What is the soul?",
    sessionContext: { conversationHistory: [] },
    requestId: "r6",
  });

  assert.deepEqual(result.jain_keywords, []);
  assert.deepEqual(result.normal_keywords, ["soul", "liberation"]);
});

test("runKeywordExtraction handles null kb_subworkflows without error", async () => {
  const provider = {
    completeJson: async () => ({
      text: '{"language":"hi","workflow":"basic_question_v1","is_followup":false,"keywords":["आत्मा"],"filters":{},"kb_subworkflows":null}',
      usage_normalized: {},
    }),
  };

  const result = await runKeywordExtraction({
    provider,
    question: "Atma kya hai?",
    sessionContext: { conversationHistory: [] },
    requestId: "r7",
  });

  assert.equal(result.kb_subworkflows, null);
});

test("runKeywordExtraction snapshot: prompt contains jain classification section marker", async () => {
  let capturedPrompt = "";
  const provider = {
    completeJson: async ({ messages }) => {
      capturedPrompt = messages[1].content;
      return {
        text: '{"language":"hi","workflow":"basic_question_v1","is_followup":false,"keywords":["आत्मा"],"filters":{}}',
        usage_normalized: {},
      };
    },
  };

  await runKeywordExtraction({
    provider,
    question: "Atma kya hai?",
    sessionContext: { conversationHistory: [] },
    requestId: "r8",
  });

  assert.ok(capturedPrompt.includes("jain_keywords"), "prompt should mention jain_keywords");
  assert.ok(capturedPrompt.includes("normal_keywords"), "prompt should mention normal_keywords");
  assert.ok(capturedPrompt.includes("kb_subworkflows"), "prompt should mention kb_subworkflows");
  assert.ok(capturedPrompt.includes("direct_retrieval"), "prompt should mention direct_retrieval sub-workflow");
});
