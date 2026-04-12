import { test } from "node:test";
import assert from "node:assert/strict";

import { runFollowupQuestion } from "../../../src/orchestrator/workflows/followup_question_v1.js";

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

test("followup workflow runs separate searches per followup keyword set", async () => {
  const calls = [];
  const externalApi = {
    search: async (payload) => {
      calls.push(payload.query);
      return [];
    },
    navigate: async () => [],
  };

  const params = {
    language: "hi",
    filters: {},
    keywords: ["मुख्य"],
    followup_keywords: [
      { id: "set_1", keywords: ["पहला"] },
      { id: "set_2", keywords: ["दूसरा", "सेट"] },
    ],
    expand_chunk_ids: [],
  };

  const toolBudget = createToolBudget(5);
  await runFollowupQuestion({
    externalApi,
    params,
    requestId: "r1",
    toolBudget,
    modelId: "gemini-2.5-flash",
  });

  assert.deepEqual(calls, ["मुख्य", "पहला", "दूसरा सेट"]);
});

test("followup workflow caps expand_chunk_ids to config limit", async () => {
  const navigated = [];
  const externalApi = {
    search: async () => [],
    navigate: async (payload) => {
      navigated.push(payload.chunk_id);
      if (!payload.language) {
        throw new Error("missing_language");
      }
      return [];
    },
  };

  const expandIds = Array.from({ length: 20 }, (_, i) => `c${i + 1}`);
  const params = {
    language: "hi",
    filters: {},
    keywords: ["मुख्य"],
    followup_keywords: [],
    expand_chunk_ids: expandIds,
  };

  const toolBudget = createToolBudget(30);
  await runFollowupQuestion({
    externalApi,
    params,
    requestId: "r1",
    toolBudget,
    modelId: "gemini-2.5-flash",
  });

  assert.equal(navigated.length, 10);
  assert.deepEqual(navigated, expandIds.slice(0, 10));
});

test("followup workflow handles distinct followup queries", async () => {
  const calls = [];
  const externalApi = {
    search: async (payload) => {
      calls.push(payload.query);
      return [];
    },
    navigate: async () => [],
  };

  const params = {
    language: "hi",
    filters: {},
    queries: [
      { id: "q1", keywords: ["पहला"] },
      { id: "q2", keywords: ["दूसरा", "प्रश्न"] },
    ],
    followup_keywords: [],
    expand_chunk_ids: [],
  };

  const toolBudget = createToolBudget(5);
  await runFollowupQuestion({
    externalApi,
    params,
    requestId: "r1",
    toolBudget,
    modelId: "gemini-2.5-flash",
  });

  assert.deepEqual(calls, ["पहला", "दूसरा प्रश्न"]);
});

test("followup workflow handles nested followup queries", async () => {
  const calls = [];
  const externalApi = {
    search: async (payload) => {
      calls.push(payload.query);
      return [];
    },
    navigate: async () => [],
  };

  const params = {
    language: "hi",
    filters: {},
    main_query: { keywords: ["मुख्य"] },
    sub_queries: [
      { id: "s1", keywords: ["उप", "एक"] },
      { id: "s2", keywords: ["उप", "दो"] },
    ],
    followup_keywords: [],
    expand_chunk_ids: [],
  };

  const toolBudget = createToolBudget(5);
  await runFollowupQuestion({
    externalApi,
    params,
    requestId: "r1",
    toolBudget,
    modelId: "gemini-2.5-flash",
  });

  assert.deepEqual(calls, ["मुख्य उप एक", "मुख्य उप दो"]);
});
