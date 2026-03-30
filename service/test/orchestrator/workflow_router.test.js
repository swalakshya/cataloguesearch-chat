import { test } from "node:test";
import assert from "node:assert/strict";

import { runWorkflow } from "../../src/orchestrator/workflow_router.js";

test("runWorkflow throws for unknown workflow", async () => {
  await assert.rejects(
    () =>
      runWorkflow({
        externalApi: {},
        keywordResult: { workflow: "missing_workflow", language: "hi" },
        requestId: "r1",
      }),
    /Unknown workflow/
  );
});

test("runWorkflow resolves filters via external API", async () => {
  const captured = [];
  const externalApi = {
    getFilterOptions: async (payload) => {
      captured.push(payload);
      return {
        granths: ["Samaysaar"],
        anuyogs: [],
        contributors: [],
      };
    },
    search: async (payload) => {
      captured.push(payload);
      return [];
    },
  };

  await runWorkflow({
    externalApi,
    keywordResult: {
      workflow: "basic_question_v1",
      language: "hi",
      keywords: ["आत्मा"],
      filters: { granth: "Samay", content_type: ["Granth"] },
    },
    requestId: "r1",
  });

  const filterCall = captured.find((entry) => entry && entry.content_type && !entry.query);
  const searchCall = captured.find((entry) => entry && entry.query);
  assert.equal(filterCall.language, "hi");
  assert.equal(searchCall.granth, "Samaysaar");
  assert.deepEqual(searchCall.content_type, ["Granth"]);
});
