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
