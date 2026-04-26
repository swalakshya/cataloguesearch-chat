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
    modelId: "gemini-2.5-flash",
  });

  assert.equal(captured.query, "आत्मा गुण");
  assert.equal(captured.granth, "Samaysaar");
  assert.equal(captured.page_size, 15);
});

test("basic workflow fires parallel guj search when gujChunks=true and keywords_guj present", async () => {
  const calls = [];
  const externalApi = {
    search: async (payload) => {
      calls.push({ language: payload.language, query: payload.query });
      return [];
    },
  };

  const params = {
    language: "hi",
    keywords: ["आत्मा"],
    keywords_guj: ["આત્મા"],
    filters: {},
    gujChunks: true,
  };

  await runBasicQuestion({
    externalApi,
    params,
    requestId: "r1",
    toolBudget: createToolBudget(5),
    modelId: "gemini-2.5-flash",
  });

  assert.equal(calls.length, 2);
  const guCall = calls.find((c) => c.language === "gu");
  assert.ok(guCall, "expected a gu language search call");
  assert.equal(guCall.query, "આત્મા");
  const hiCall = calls.find((c) => c.language === "hi");
  assert.ok(hiCall, "expected a hi language search call");
});

test("basic workflow tags chunks with _lang when gujChunks=true", async () => {
  const externalApi = {
    search: async () => [{ chunk_id: "c1", text_content: "text" }],
  };

  const params = {
    language: "hi",
    keywords: ["आत्मा"],
    keywords_guj: ["આત્મા"],
    filters: {},
    gujChunks: true,
  };

  const results = await runBasicQuestion({
    externalApi,
    params,
    requestId: "r1",
    toolBudget: createToolBudget(5),
    modelId: "gemini-2.5-flash",
  });

  const hiChunks = results.filter((c) => c._lang === "hi");
  const guChunks = results.filter((c) => c._lang === "gu");
  assert.ok(hiChunks.length > 0, "expected hi-tagged chunks");
  assert.ok(guChunks.length > 0, "expected gu-tagged chunks");
});

test("basic workflow skips guj search when keywords_guj empty", async () => {
  const calls = [];
  const externalApi = {
    search: async (payload) => {
      calls.push(payload);
      return [];
    },
  };

  const params = {
    language: "hi",
    keywords: ["आत्मा"],
    keywords_guj: [],
    filters: {},
    gujChunks: true,
  };

  await runBasicQuestion({
    externalApi,
    params,
    requestId: "r1",
    toolBudget: createToolBudget(5),
    modelId: "gemini-2.5-flash",
  });

  assert.equal(calls.length, 1);
});

test("basic workflow uses gujarati_page_size from config", async () => {
  const callPageSizes = [];
  const externalApi = {
    search: async (payload) => {
      callPageSizes.push({ language: payload.language, page_size: payload.page_size });
      return [];
    },
  };

  const params = {
    language: "hi",
    keywords: ["आत्मा"],
    keywords_guj: ["આત્મા"],
    filters: {},
    gujChunks: true,
  };

  await runBasicQuestion({
    externalApi,
    params,
    requestId: "r1",
    toolBudget: createToolBudget(5),
    modelId: "gemini-2.5-flash",
  });

  const hiCall = callPageSizes.find((c) => c.language === "hi");
  const guCall = callPageSizes.find((c) => c.language === "gu");
  assert.equal(hiCall.page_size, 15);
  assert.equal(guCall.page_size, 5);
});
