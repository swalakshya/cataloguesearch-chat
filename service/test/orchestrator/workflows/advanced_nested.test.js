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
