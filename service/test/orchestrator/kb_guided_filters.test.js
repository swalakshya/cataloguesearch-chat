import { test } from "node:test";
import assert from "node:assert/strict";
import { deriveGuidedFilters, fetchGuidedResults } from "../../src/orchestrator/kb_guided_filters.js";

function createToolBudget(limit) {
  let remaining = limit;
  return { remaining: () => remaining, consume: () => { remaining -= 1; } };
}

test("returns empty array for null / empty topics", () => {
  assert.deepEqual(deriveGuidedFilters(null), []);
  assert.deepEqual(deriveGuidedFilters([]), []);
  assert.deepEqual(deriveGuidedFilters(undefined), []);
});

test("returns empty array when topics have no references", () => {
  const topics = [{ topic_natural_key: "aatma", references: [] }];
  assert.deepEqual(deriveGuidedFilters(topics), []);
});

test("returns empty array when all references have all-null fields", () => {
  const topics = [
    {
      references: [
        { shastra_natural_key: null, gatha_number: null, page_number: null, teeka_natural_key: null },
      ],
    },
  ];
  assert.deepEqual(deriveGuidedFilters(topics), []);
});

test("extracts a single reference into a guided filter", () => {
  const topics = [
    {
      references: [{ shastra_natural_key: "samaysaar", gatha_number: 6, page_number: null, teeka_natural_key: null }],
    },
  ];
  assert.deepEqual(deriveGuidedFilters(topics), [
    { shastra: "samaysaar", gatha: 6, page: null, teeka: null },
  ]);
});

test("deduplicates identical references across topics", () => {
  const ref = { shastra_natural_key: "samaysaar", gatha_number: 6, page_number: null, teeka_natural_key: null };
  const topics = [
    { references: [ref] },
    { references: [ref] },
  ];
  const result = deriveGuidedFilters(topics);
  assert.equal(result.length, 1);
});

test("deduplicates identical references within the same topic", () => {
  const ref = { shastra_natural_key: "samaysaar", gatha_number: 1, page_number: null, teeka_natural_key: null };
  const topics = [{ references: [ref, ref, ref] }];
  const result = deriveGuidedFilters(topics);
  assert.equal(result.length, 1);
});

test("respects cap parameter", () => {
  const topics = [
    {
      references: [
        { shastra_natural_key: "s1", gatha_number: 1 },
        { shastra_natural_key: "s2", gatha_number: 2 },
        { shastra_natural_key: "s3", gatha_number: 3 },
        { shastra_natural_key: "s4", gatha_number: 4 },
        { shastra_natural_key: "s5", gatha_number: 5 },
        { shastra_natural_key: "s6", gatha_number: 6 },
      ],
    },
  ];
  assert.equal(deriveGuidedFilters(topics, 3).length, 3);
});

test("uses env var cap when no explicit cap given", () => {
  const original = process.env.KB_GUIDED_FILTERS_CAP;
  process.env.KB_GUIDED_FILTERS_CAP = "2";
  try {
    const topics = [
      {
        references: [
          { shastra_natural_key: "s1", gatha_number: 1 },
          { shastra_natural_key: "s2", gatha_number: 2 },
          { shastra_natural_key: "s3", gatha_number: 3 },
        ],
      },
    ];
    assert.equal(deriveGuidedFilters(topics).length, 2);
  } finally {
    if (original === undefined) delete process.env.KB_GUIDED_FILTERS_CAP;
    else process.env.KB_GUIDED_FILTERS_CAP = original;
  }
});

test("handles topic with no references field (undefined)", () => {
  const topics = [{ topic_natural_key: "aatma" }];
  assert.deepEqual(deriveGuidedFilters(topics), []);
});

test("collects references from multiple topics in order", () => {
  const topics = [
    { references: [{ shastra_natural_key: "s1", gatha_number: 1 }] },
    { references: [{ shastra_natural_key: "s2", gatha_number: 2 }] },
  ];
  const result = deriveGuidedFilters(topics);
  assert.equal(result.length, 2);
  assert.equal(result[0].shastra, "s1");
  assert.equal(result[1].shastra, "s2");
});

test("maps reference fields to filter fields correctly", () => {
  const topics = [
    {
      references: [
        {
          shastra_natural_key: "samaysaar",
          gatha_number: 42,
          page_number: 100,
          teeka_natural_key: "teeka_one",
        },
      ],
    },
  ];
  const [f] = deriveGuidedFilters(topics);
  assert.equal(f.shastra, "samaysaar");
  assert.equal(f.gatha, 42);
  assert.equal(f.page, 100);
  assert.equal(f.teeka, "teeka_one");
});

test("skips null-only refs but includes partial refs (shastra only)", () => {
  const topics = [
    {
      references: [
        { shastra_natural_key: null, gatha_number: null, page_number: null, teeka_natural_key: null },
        { shastra_natural_key: "niyamsaar", gatha_number: null, page_number: null, teeka_natural_key: null },
      ],
    },
  ];
  const result = deriveGuidedFilters(topics);
  assert.equal(result.length, 1);
  assert.equal(result[0].shastra, "niyamsaar");
});

test("cap=0 returns empty array", () => {
  const topics = [{ references: [{ shastra_natural_key: "s", gatha_number: 1 }] }];
  assert.deepEqual(deriveGuidedFilters(topics, 0), []);
});

// ─── fetchGuidedResults ───────────────────────────────────────────────────────

test("fetchGuidedResults returns [] when no filters or no query", async () => {
  const externalApi = { search: async () => { throw new Error("should not call"); } };
  assert.deepEqual(await fetchGuidedResults({ externalApi, guidedFilters: [], query: "q" }), []);
  assert.deepEqual(await fetchGuidedResults({ externalApi, guidedFilters: [{ shastra: "s" }], query: "" }), []);
});

test("fetchGuidedResults fires one search per filter and maps shastra → granth", async () => {
  const payloads = [];
  const externalApi = {
    search: async (payload) => { payloads.push(payload); return [{ chunk_id: "g" }]; },
  };
  const out = await fetchGuidedResults({
    externalApi,
    guidedFilters: [
      { shastra: "samaysaar", gatha: 6, page: null, teeka: null },
      { shastra: "niyamsaar", gatha: null, page: null, teeka: null },
    ],
    baseFilters: { content_type: ["Granth"], rerank: true },
    query: "मोक्ष",
    language: "hi",
    requestId: "r1",
    toolBudget: createToolBudget(5),
  });

  assert.equal(payloads.length, 2);
  assert.equal(payloads[0].granth, "samaysaar");
  assert.equal(payloads[0].page_size, 3);
  assert.equal(payloads[0].page, 1);
  assert.equal(payloads[0].query, "मोक्ष");
  assert.equal(payloads[0].rerank, true);
  assert.equal(out.length, 2);
  assert.equal(out[0].guided_filter.shastra, "samaysaar");
  assert.equal(out[0].results.length, 1);
});

test("fetchGuidedResults stops when tool budget is exhausted", async () => {
  let calls = 0;
  const externalApi = { search: async () => { calls += 1; return []; } };
  const out = await fetchGuidedResults({
    externalApi,
    guidedFilters: [{ shastra: "a" }, { shastra: "b" }, { shastra: "c" }],
    query: "q",
    toolBudget: createToolBudget(1),
  });
  assert.equal(calls, 1);
  assert.equal(out.length, 1);
});

test("fetchGuidedResults skips a filter whose search throws", async () => {
  const externalApi = {
    search: async (payload) => {
      if (payload.granth === "bad") throw new Error("boom");
      return [{ chunk_id: "ok" }];
    },
  };
  const out = await fetchGuidedResults({
    externalApi,
    guidedFilters: [{ shastra: "bad" }, { shastra: "good" }],
    query: "q",
    toolBudget: createToolBudget(5),
  });
  assert.equal(out.length, 1);
  assert.equal(out[0].guided_filter.shastra, "good");
});

test("fetchGuidedResults honours KB_GUIDED_PAGE_SIZE env override", async () => {
  const prev = process.env.KB_GUIDED_PAGE_SIZE;
  process.env.KB_GUIDED_PAGE_SIZE = "7";
  try {
    let captured;
    const externalApi = { search: async (p) => { captured = p; return []; } };
    await fetchGuidedResults({
      externalApi,
      guidedFilters: [{ shastra: "s" }],
      query: "q",
      toolBudget: createToolBudget(5),
    });
    assert.equal(captured.page_size, 7);
  } finally {
    if (prev === undefined) delete process.env.KB_GUIDED_PAGE_SIZE;
    else process.env.KB_GUIDED_PAGE_SIZE = prev;
  }
});
