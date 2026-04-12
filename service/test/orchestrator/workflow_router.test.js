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
        modelId: "gemini-2.5-flash",
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
    modelId: "gemini-2.5-flash",
  });

  const filterCall = captured.find((entry) => entry && entry.content_type && !entry.query);
  const searchCall = captured.find((entry) => entry && entry.query);
  assert.equal(filterCall.language, "hi");
  assert.equal(searchCall.granth, "Samaysaar");
  assert.deepEqual(searchCall.content_type, ["Granth"]);
});

test("runWorkflow skips filter options when only default content_type", async () => {
  const calls = [];
  const externalApi = {
    getFilterOptions: async (payload) => {
      calls.push({ type: "filter", payload });
      return { granths: [], anuyogs: [], contributors: [] };
    },
    search: async (payload) => {
      calls.push({ type: "search", payload });
      return [];
    },
  };

  await runWorkflow({
    externalApi,
    keywordResult: {
      workflow: "basic_question_v1",
      language: "hi",
      keywords: ["आत्मा"],
      filters: { content_type: ["Granth", "Books"] },
    },
    requestId: "r1",
    modelId: "gemini-2.5-flash",
  });

  const filterCalls = calls.filter((c) => c.type === "filter");
  assert.equal(filterCalls.length, 0);
});

test("runWorkflow handles metadata_question_v1 with filter options only", async () => {
  const calls = [];
  const externalApi = {
    getMetadataOptions: async (payload) => {
      calls.push({ type: "filter", payload });
      return [{ granth: "Samaysaar", author: "Kundkund", anuyog: "Dravyanuyog", url: "https://x" }];
    },
    search: async () => {
      calls.push({ type: "search" });
      return [];
    },
  };

  const result = await runWorkflow({
    externalApi,
    keywordResult: {
      workflow: "metadata_question_v1",
      language: "hi",
      asked_info: ["granth"],
      filters: { content_type: ["Granth"] },
    },
    requestId: "r1",
    modelId: "gemini-2.5-flash",
  });

  assert.equal(calls.some((c) => c.type === "search"), false);
  assert.equal(calls.some((c) => c.type === "filter"), true);
  assert.deepEqual(result.chunks, [
    { kind: "metadata", asked_info: ["granth"], options: [{ g: "Samaysaar" }] },
  ]);
});

test("runWorkflow maps mismatched filters with llm", async () => {
  const calls = [];
  const externalApi = {
    getFilterOptions: async () => ({ granths: ["Samaysaar"], anuyogs: [], contributors: [] }),
    search: async (payload) => {
      calls.push(payload);
      return [];
    },
  };
  const provider = {
    completeJson: async () =>
      JSON.stringify({ granth: "Samaysaar", anuyog: "", contributor: "" }),
  };

  await runWorkflow({
    externalApi,
    provider,
    keywordResult: {
      workflow: "basic_question_v1",
      language: "hi",
      keywords: ["आत्मा"],
      filters: { granth: "Samyasar", content_type: ["Granth"] },
    },
    requestId: "r1",
    modelId: "gemini-2.5-flash",
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].granth, "Samaysaar");
});
