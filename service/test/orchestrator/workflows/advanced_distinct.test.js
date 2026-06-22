import { test } from "node:test";
import assert from "node:assert/strict";

import { runAdvancedDistinctQuestions } from "../../../src/orchestrator/workflows/advanced_distinct_questions_v1.js";

function createToolBudget(limit) {
  let remaining = limit;
  return {
    remaining() {
      return remaining;
    },
    consume() {
      remaining -= 1;
    },
  };
}

test("advanced distinct workflow runs search per query", async () => {
  const queries = [];
  const externalApi = {
    search: async (payload) => {
      queries.push(payload.query);
      return [];
    },
  };

  const params = {
    language: "hi",
    filters: {},
    queries: [
      { id: "q1", keywords: ["पहला"] },
      { id: "q2", keywords: ["दूसरा", "प्रश्न"] },
    ],
  };

  await runAdvancedDistinctQuestions({
    externalApi,
    params,
    requestId: "r1",
    toolBudget: createToolBudget(5),
    modelId: "gemini-2.5-flash",
  });

  assert.deepEqual(queries, ["पहला", "दूसरा प्रश्न"]);
});

test("advanced_distinct fires parallel guj searches per query when gujChunks=true", async () => {
  const calls = [];
  const externalApi = {
    search: async (payload) => {
      calls.push({ language: payload.language, query: payload.query });
      return [];
    },
  };

  const params = {
    language: "hi",
    filters: {},
    gujChunks: true,
    queries: [
      { id: "q1", keywords: ["पहला"], keywords_guj: ["પ્રથમ"] },
      { id: "q2", keywords: ["दूसरा"], keywords_guj: ["બીજું"] },
    ],
  };

  await runAdvancedDistinctQuestions({
    externalApi,
    params,
    requestId: "r1",
    toolBudget: createToolBudget(10),
    modelId: "gemini-2.5-flash",
  });

  assert.equal(calls.length, 4);
  const guCalls = calls.filter((c) => c.language === "gu");
  assert.equal(guCalls.length, 2);
});

test("advanced_distinct returns { chunks, guidedResults } shape", async () => {
  const externalApi = {
    search: async () => [{ chunk_id: "c1" }],
  };

  const params = {
    language: "hi",
    filters: {},
    queries: [{ id: "q1", keywords: ["मोक्ष"] }],
  };

  const result = await runAdvancedDistinctQuestions({
    externalApi,
    params,
    requestId: "r1",
    toolBudget: createToolBudget(5),
    modelId: "gemini-2.5-flash",
  });

  assert.ok("chunks" in result && "guidedResults" in result);
  assert.equal(result.chunks.length, 1);
  assert.deepEqual(result.guidedResults, []);
});

test("advanced_distinct fires a separate filtered search per guided filter", async () => {
  const payloads = [];
  const externalApi = {
    search: async (payload) => {
      payloads.push(payload);
      return [];
    },
  };

  const params = {
    language: "hi",
    filters: {},
    queries: [{ id: "q1", keywords: ["मोक्ष"] }],
    mergedTopics: [
      { references: [{ shastra_natural_key: "नियमसार", gatha_number: 10 }] },
    ],
  };

  await runAdvancedDistinctQuestions({
    externalApi,
    params,
    requestId: "r1",
    toolBudget: createToolBudget(5),
    modelId: "gemini-2.5-flash",
  });

  const guidedCall = payloads.find((p) => p.granth === "Niyamsaar");
  assert.ok(guidedCall, "expected a guided search mapping shastra → granth");
  assert.equal(guidedCall.page_size, 3);
  assert.equal(guidedCall.query, "मोक्ष", "guided search reuses the first query");
});

test("advanced_distinct collects one guided result per derived filter", async () => {
  const externalApi = {
    search: async (payload) => {
      if (payload.granth === "Niyamsaar" || payload.granth === "Ishtopadesh") {
        return [{ chunk_id: `g-${payload.granth}` }];
      }
      return [];
    },
  };

  const params = {
    language: "hi",
    filters: {},
    queries: [
      { id: "q1", keywords: ["पहला"] },
      { id: "q2", keywords: ["दूसरा"] },
    ],
    mergedTopics: [
      { references: [{ shastra_natural_key: "नियमसार", gatha_number: 1 }] },
      { references: [{ shastra_natural_key: "इष्टोपदेश", gatha_number: 2 }] },
    ],
  };

  const { guidedResults } = await runAdvancedDistinctQuestions({
    externalApi,
    params,
    requestId: "r1",
    toolBudget: createToolBudget(8),
    modelId: "gemini-2.5-flash",
  });

  assert.equal(guidedResults.length, 2);
  assert.deepEqual(guidedResults.map((g) => g.guided_filter.shastra).sort(), ["इष्टोपदेश", "नियमसार"]);
});
