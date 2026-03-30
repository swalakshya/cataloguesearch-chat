import { test } from "node:test";
import assert from "node:assert/strict";

import { runBasicQuestion } from "../../../src/orchestrator/workflows/basic_question_v1.js";

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

test("basic workflow builds query and calls search", async () => {
  let captured;
  const externalApi = {
    search: async (payload) => {
      captured = payload;
      return [];
    },
  };

  const params = {
    language: "hi",
    keywords: ["आत्मा", "गुण"],
    filters: { granth: "Samaysaar" },
  };

  await runBasicQuestion({
    externalApi,
    params,
    requestId: "r1",
    toolBudget: createToolBudget(2),
  });

  assert.equal(captured.query, "आत्मा गुण");
  assert.equal(captured.granth, "Samaysaar");
  assert.equal(captured.page_size, 15);
});
