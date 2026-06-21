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

// The agent API search returns a flat chunk array. Guided retrieval is fired
// chat-side as separate filtered search calls (see fetchGuidedResults).
function makeApi(chunks = []) {
  return {
    search: async () => chunks,
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

  const { chunks } = await runBasicQuestion({
    externalApi,
    params,
    requestId: "r1",
    toolBudget: createToolBudget(5),
    modelId: "gemini-2.5-flash",
  });

  const hiChunks = chunks.filter((c) => c._lang === "hi");
  const guChunks = chunks.filter((c) => c._lang === "gu");
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

test("basic workflow returns { chunks, guidedResults } shape", async () => {
  const externalApi = makeApi([{ chunk_id: "c1" }]);
  const params = { language: "hi", keywords: ["आत्मा"], filters: {} };

  const result = await runBasicQuestion({
    externalApi,
    params,
    requestId: "r1",
    toolBudget: createToolBudget(2),
    modelId: "gemini-2.5-flash",
  });

  assert.ok("chunks" in result, "result should have chunks");
  assert.ok("guidedResults" in result, "result should have guidedResults");
  assert.ok(Array.isArray(result.chunks));
  assert.ok(Array.isArray(result.guidedResults));
});

test("basic workflow fires a separate filtered search per guided filter", async () => {
  const calls = [];
  const externalApi = {
    search: async (payload) => {
      calls.push(payload);
      return [];
    },
  };

  const params = {
    language: "hi",
    keywords: ["मोक्ष"],
    filters: {},
    mergedTopics: [
      {
        topic_natural_key: "moksha",
        references: [{ shastra_natural_key: "samaysaar", gatha_number: 6, page_number: null, teeka_natural_key: null }],
      },
    ],
  };

  await runBasicQuestion({
    externalApi,
    params,
    requestId: "r1",
    toolBudget: createToolBudget(3),
    modelId: "gemini-2.5-flash",
  });

  // 1 default search + 1 guided search (shastra → granth, page_size 3)
  assert.equal(calls.length, 2);
  const guidedCall = calls.find((c) => c.granth === "samaysaar");
  assert.ok(guidedCall, "expected a guided search mapping shastra → granth");
  assert.equal(guidedCall.page_size, 3);
  assert.equal(guidedCall.query, "मोक्ष");
});

test("basic workflow fires no guided search when mergedTopics is empty", async () => {
  const calls = [];
  const externalApi = {
    search: async (payload) => {
      calls.push(payload);
      return [];
    },
  };

  const params = { language: "hi", keywords: ["मोक्ष"], filters: {}, mergedTopics: [] };

  await runBasicQuestion({
    externalApi,
    params,
    requestId: "r1",
    toolBudget: createToolBudget(2),
    modelId: "gemini-2.5-flash",
  });

  assert.equal(calls.length, 1, "only the default search should fire");
});

test("basic workflow collects guided_results from the per-filter searches", async () => {
  const externalApi = {
    search: async (payload) => {
      if (payload.granth === "samaysaar") {
        return [{ chunk_id: "g1", text_content: "guided text" }];
      }
      return [{ chunk_id: "c1" }];
    },
  };

  const params = {
    language: "hi",
    keywords: ["मोक्ष"],
    filters: {},
    mergedTopics: [{ references: [{ shastra_natural_key: "samaysaar", gatha_number: 6 }] }],
  };

  const { guidedResults } = await runBasicQuestion({
    externalApi,
    params,
    requestId: "r1",
    toolBudget: createToolBudget(3),
    modelId: "gemini-2.5-flash",
  });

  assert.equal(guidedResults.length, 1);
  assert.equal(guidedResults[0].guided_filter.shastra, "samaysaar");
  assert.equal(guidedResults[0].guided_filter.gatha, 6);
  assert.equal(guidedResults[0].results.length, 1);
});

test("basic workflow proceeds normally with no guided results when no topics", async () => {
  const externalApi = {
    search: async () => [{ chunk_id: "c1" }],
  };

  const params = { language: "hi", keywords: ["मोक्ष"], filters: {} };

  const { chunks, guidedResults } = await runBasicQuestion({
    externalApi,
    params,
    requestId: "r1",
    toolBudget: createToolBudget(2),
    modelId: "gemini-2.5-flash",
  });

  assert.equal(chunks.length, 1);
  assert.deepEqual(guidedResults, []);
});
