import { test } from "node:test";
import assert from "node:assert/strict";

import { runAdvancedNestedQuestions } from "../../../src/orchestrator/workflows/advanced_nested_questions_v1.js";

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

test("advanced nested workflow runs main search plus combined searches per subquery", async () => {
  const calls = [];
  const externalApi = {
    search: async (payload) => {
      calls.push({ type: "search", query: payload.query });
      return [];
    },
  };

  const params = {
    language: "hi",
    filters: {},
    main_query: { keywords: ["मुख्य"] },
    sub_queries: [
      { id: "s1", keywords: ["उप", "एक"] },
      { id: "s2", keywords: ["उप", "दो"] },
    ],
  };

  await runAdvancedNestedQuestions({
    externalApi,
    params,
    requestId: "r1",
    toolBudget: createToolBudget(10),
    modelId: "gemini-2.5-flash",
  });

  assert.deepEqual(calls, [
    { type: "search", query: "मुख्य" },
    { type: "search", query: "मुख्य उप एक" },
    { type: "search", query: "मुख्य उप दो" },
  ]);
});

test("advanced nested workflow falls back to main query when no subqueries", async () => {
  const calls = [];
  const externalApi = {
    search: async (payload) => {
      calls.push({ type: "search", query: payload.query });
      return [];
    },
  };

  const params = {
    language: "hi",
    filters: {},
    main_query: { keywords: ["मुख्य"] },
    sub_queries: [],
  };

  await runAdvancedNestedQuestions({
    externalApi,
    params,
    requestId: "r1",
    toolBudget: createToolBudget(5),
    modelId: "gemini-2.5-flash",
  });

  assert.deepEqual(calls, [{ type: "search", query: "मुख्य" }]);
});

test("advanced_nested fires parallel guj searches when gujChunks=true", async () => {
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
    main_query: { keywords: ["मुख्य"], keywords_guj: ["મુખ્ય"] },
    sub_queries: [
      { id: "s1", keywords: ["उप"], keywords_guj: ["ઉપ"] },
    ],
  };

  await runAdvancedNestedQuestions({
    externalApi,
    params,
    requestId: "r1",
    toolBudget: createToolBudget(10),
    modelId: "gemini-2.5-flash",
  });

  assert.equal(calls.length, 4);
  const guCalls = calls.filter((c) => c.language === "gu");
  const hiCalls = calls.filter((c) => c.language === "hi");
  assert.equal(guCalls.length, 2);
  assert.equal(hiCalls.length, 2);
});

test("advanced_nested returns { chunks, guidedResults } shape", async () => {
  const externalApi = {
    search: async () => [{ chunk_id: "c1" }],
  };

  const params = {
    language: "hi",
    filters: {},
    main_query: { keywords: ["मुख्य"] },
    sub_queries: [],
  };

  const result = await runAdvancedNestedQuestions({
    externalApi,
    params,
    requestId: "r1",
    toolBudget: createToolBudget(5),
    modelId: "gemini-2.5-flash",
  });

  assert.ok("chunks" in result && "guidedResults" in result);
  assert.ok(Array.isArray(result.chunks) && Array.isArray(result.guidedResults));
});

test("advanced_nested fires a separate filtered search per guided filter", async () => {
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
    main_query: { keywords: ["मुख्य"] },
    sub_queries: [],
    mergedTopics: [
      { references: [{ shastra_natural_key: "pravachansar", gatha_number: 5 }] },
    ],
  };

  await runAdvancedNestedQuestions({
    externalApi,
    params,
    requestId: "r1",
    toolBudget: createToolBudget(5),
    modelId: "gemini-2.5-flash",
  });

  const guidedCall = payloads.find((p) => p.granth === "pravachansar");
  assert.ok(guidedCall, "expected a guided search mapping shastra → granth");
  assert.equal(guidedCall.page_size, 3);
  assert.equal(guidedCall.query, "मुख्य", "guided search reuses the main Hindi query");
});

test("advanced_nested collects one guided result per derived filter", async () => {
  const externalApi = {
    search: async (payload) => {
      if (payload.granth === "s1" || payload.granth === "s2") {
        return [{ chunk_id: `g-${payload.granth}` }];
      }
      return [];
    },
  };

  const params = {
    language: "hi",
    filters: {},
    main_query: { keywords: ["मुख्य"] },
    sub_queries: [{ id: "s1", keywords: ["उप"] }],
    mergedTopics: [
      { references: [{ shastra_natural_key: "s1", gatha_number: 1 }] },
      { references: [{ shastra_natural_key: "s2", gatha_number: 2 }] },
    ],
  };

  const { guidedResults } = await runAdvancedNestedQuestions({
    externalApi,
    params,
    requestId: "r1",
    toolBudget: createToolBudget(8),
    modelId: "gemini-2.5-flash",
  });

  assert.equal(guidedResults.length, 2);
  assert.deepEqual(guidedResults.map((g) => g.guided_filter.shastra).sort(), ["s1", "s2"]);
});
