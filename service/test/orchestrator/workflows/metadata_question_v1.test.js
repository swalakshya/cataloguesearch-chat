import { test } from "node:test";
import assert from "node:assert/strict";

import { runMetadataQuestion } from "../../../src/orchestrator/workflows/metadata_question_v1.js";

function createToolBudget(limit = 10) {
  let remaining = limit;
  return {
    remaining() { return remaining; },
    consume() { remaining -= 1; },
  };
}

function makeExternalApi(options = [{ granth: "Samaysaar", author: "Kundkund", anuyog: "Dravyanuyog", url: "" }]) {
  return {
    getMetadataOptions: async () => options,
  };
}

function makeKbApiClient({ shastras = [], authors = [] } = {}) {
  return {
    shastras: async () => shastras,
    authors: async () => authors,
  };
}

// ─── Return shape ─────────────────────────────────────────────────────────────

test("runMetadataQuestion: returns object with chunks and kbMetadataSection", async () => {
  const result = await runMetadataQuestion({
    externalApi: makeExternalApi(),
    params: { language: "hi", filters: { content_type: ["granth"] }, asked_info: ["granth"] },
    requestId: "r1",
    toolBudget: createToolBudget(),
  });

  assert.ok("chunks" in result, "result has chunks");
  assert.ok("kbMetadataSection" in result, "result has kbMetadataSection");
  assert.ok(Array.isArray(result.chunks), "chunks is array");
  assert.equal(result.chunks[0].kind, "metadata");
});

// ─── No kb client ─────────────────────────────────────────────────────────────

test("runMetadataQuestion: kbMetadataSection empty when no kbApiClient", async () => {
  const result = await runMetadataQuestion({
    externalApi: makeExternalApi(),
    params: {
      language: "hi",
      filters: { content_type: ["granth"] },
      asked_info: ["granth"],
      kb_entities: { shastra_hints: ["samaysaar"], author_hints: [] },
    },
    requestId: "r1",
    toolBudget: createToolBudget(),
  });

  assert.equal(result.kbMetadataSection, "");
});

// ─── With kb client and hints ─────────────────────────────────────────────────

test("runMetadataQuestion with shastra_hint: both lists appear in result", async () => {
  const kbApiClient = makeKbApiClient({
    shastras: [{ name: "समयसार", natural_key: "samaysaar", similarity: 0.78 }],
  });

  const result = await runMetadataQuestion({
    externalApi: makeExternalApi(),
    kbApiClient,
    params: {
      language: "hi",
      filters: { content_type: ["granth"] },
      asked_info: ["granth"],
      kb_entities: { shastra_hints: ["samaysaar"], author_hints: [] },
    },
    requestId: "r1",
    toolBudget: createToolBudget(),
  });

  assert.ok(result.kbMetadataSection.includes("KB Metadata Matches"), "kb section heading present");
  assert.ok(result.kbMetadataSection.includes("समयसार"), "shastra match present");
  assert.equal(result.chunks[0].kind, "metadata", "cataloguesearch metadata present");
});

test("runMetadataQuestion: no kb metadata call when hints absent", async () => {
  let shastrasCalled = false;
  const kbApiClient = {
    shastras: async () => { shastrasCalled = true; return []; },
    authors: async () => [],
  };

  const result = await runMetadataQuestion({
    externalApi: makeExternalApi(),
    kbApiClient,
    params: {
      language: "hi",
      filters: { content_type: ["granth"] },
      asked_info: ["granth"],
      kb_entities: { shastra_hints: [], author_hints: [] },
    },
    requestId: "r1",
    toolBudget: createToolBudget(),
  });

  assert.equal(shastrasCalled, false, "shastras not called when no hints");
  assert.equal(result.kbMetadataSection, "");
});

test("runMetadataQuestion: no kb metadata call when kb_entities null", async () => {
  let shastrasCalled = false;
  const kbApiClient = {
    shastras: async () => { shastrasCalled = true; return []; },
    authors: async () => [],
  };

  const result = await runMetadataQuestion({
    externalApi: makeExternalApi(),
    kbApiClient,
    params: {
      language: "hi",
      filters: { content_type: ["granth"] },
      asked_info: ["granth"],
      kb_entities: null,
    },
    requestId: "r1",
    toolBudget: createToolBudget(),
  });

  assert.equal(shastrasCalled, false, "shastras not called when kb_entities null");
  assert.equal(result.kbMetadataSection, "");
});

// ─── Failure handling ─────────────────────────────────────────────────────────

test("runMetadataQuestion: kb timeout — workflow still succeeds, section empty", async () => {
  const kbApiClient = {
    shastras: async () => { throw new Error("timeout"); },
    authors: async () => [],
  };

  const result = await runMetadataQuestion({
    externalApi: makeExternalApi(),
    kbApiClient,
    params: {
      language: "hi",
      filters: { content_type: ["granth"] },
      asked_info: ["granth"],
      kb_entities: { shastra_hints: ["samaysaar"], author_hints: [] },
    },
    requestId: "r1",
    toolBudget: createToolBudget(),
  });

  assert.equal(result.kbMetadataSection, "", "kb section empty on timeout");
  assert.equal(result.chunks[0].kind, "metadata", "cataloguesearch metadata still present");
});

// ─── Section omitted when no matches ─────────────────────────────────────────

test("runMetadataQuestion: kb returns no match — section omitted (no empty heading)", async () => {
  const kbApiClient = makeKbApiClient({ shastras: [], authors: [] });

  const result = await runMetadataQuestion({
    externalApi: makeExternalApi(),
    kbApiClient,
    params: {
      language: "hi",
      filters: { content_type: ["granth"] },
      asked_info: ["granth"],
      kb_entities: { shastra_hints: ["nonexistent"], author_hints: [] },
    },
    requestId: "r1",
    toolBudget: createToolBudget(),
  });

  assert.equal(result.kbMetadataSection, "", "section omitted when no kb matches");
});

// ─── Parallel execution ───────────────────────────────────────────────────────

test("runMetadataQuestion: kb calls fired in parallel with getMetadataOptions", async () => {
  const order = [];

  const externalApi = {
    getMetadataOptions: async () => {
      order.push("cataloguesearch_start");
      await new Promise((r) => setImmediate(r));
      order.push("cataloguesearch_done");
      return [{ granth: "Samaysaar" }];
    },
  };

  const kbApiClient = {
    shastras: async () => {
      order.push("kb_shastras_called");
      return [];
    },
    authors: async () => [],
  };

  await runMetadataQuestion({
    externalApi,
    kbApiClient,
    params: {
      language: "hi",
      filters: { content_type: ["granth"] },
      asked_info: ["granth"],
      kb_entities: { shastra_hints: ["samaysaar"], author_hints: [] },
    },
    requestId: "r1",
    toolBudget: createToolBudget(),
  });

  // kb call should be initiated before cataloguesearch resolves
  const kbIdx = order.indexOf("kb_shastras_called");
  const csStartIdx = order.indexOf("cataloguesearch_start");
  assert.ok(kbIdx >= 0 && csStartIdx >= 0, "both calls happened");
  assert.ok(kbIdx <= csStartIdx + 1, "kb fired around same time as cataloguesearch start (parallel)");
});
