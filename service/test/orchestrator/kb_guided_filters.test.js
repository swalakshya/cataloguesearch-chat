import { test } from "node:test";
import assert from "node:assert/strict";
import { deriveGuidedFilters, fetchGuidedResults, resolveGranthNames, resolveGranthFilters } from "../../src/orchestrator/kb_guided_filters.js";

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

test("derives verse-level gatha from extract main_reference (live shape)", () => {
  // Live topics_match: top-level references[] gatha_number is null; the verse
  // lives in extracts_hi[].main_reference.resolved_fields keyed by "गाथा".
  const topics = [
    {
      extracts_hi: [
        { main_reference: { shastra_name: "मोक्ष पाहुड़", teeka_name: null, resolved_fields: [{ field: "गाथा", value: 4 }] } },
      ],
      references: [{ shastra_natural_key: "मोक्ष पाहुड़", gatha_number: null, page_number: null, teeka_natural_key: null }],
    },
  ];
  // The granth-only (gatha null) topic-level ref is dropped in favour of the verse-bearing one.
  assert.deepEqual(deriveGuidedFilters(topics), [
    { shastra: "मोक्ष पाहुड़", gatha: 4, page: null, teeka: null },
  ]);
});

test("keeps granth-only ref when no extract supplies a verse for that shastra", () => {
  const topics = [
    {
      extracts_hi: [
        { main_reference: { shastra_name: "मोक्ष पाहुड़", resolved_fields: [{ field: "गाथा", value: 4 }] } },
      ],
      references: [{ shastra_natural_key: "समाधिशतक", gatha_number: null }],
    },
  ];
  assert.deepEqual(deriveGuidedFilters(topics), [
    { shastra: "मोक्ष पाहुड़", gatha: 4, page: null, teeka: null },
    { shastra: "समाधिशतक", gatha: null, page: null, teeka: null },
  ]);
});

test("maps non-gatha verse identifiers (श्लोक) per canonical gatha_identifier", () => {
  // इष्टोपदेश's gatha_identifier is "श्लोक" — the verse is NOT गाथा.
  const topics = [
    { extracts_hi: [{ main_reference: { shastra_name: "इष्टोपदेश", resolved_fields: [{ field: "श्लोक", value: 12 }] } }] },
  ];
  assert.deepEqual(deriveGuidedFilters(topics), [
    { shastra: "इष्टोपदेश", gatha: 12, page: null, teeka: null },
  ]);
});

test("strips shastra prefix and uses last component of compound identifier", () => {
  // तत्त्वार्थसूत्र's gatha_identifier is "अध्याय,सूत्र" → verse token = सूत्र;
  // the live field name is shastra-prefixed ("तत्त्वार्थसूत्रसूत्र"). पृष्ठ is the page.
  const topics = [
    {
      extracts_hi: [
        {
          main_reference: {
            shastra_name: "तत्त्वार्थसूत्र",
            resolved_fields: [
              { field: "अध्याय", value: 1 },
              { field: "तत्त्वार्थसूत्रसूत्र", value: 4 },
              { field: "पृष्ठ", value: 88 },
            ],
          },
        },
      ],
    },
  ];
  assert.deepEqual(deriveGuidedFilters(topics), [
    { shastra: "तत्त्वार्थसूत्र", gatha: 4, page: 88, teeka: null },
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
  // समयसार → 2 english_names; नियमसार → 1 english_name → 3 total calls.
  const payloads = [];
  const externalApi = {
    search: async (payload) => { payloads.push(payload); return [{ chunk_id: "g" }]; },
  };
  const out = await fetchGuidedResults({
    externalApi,
    guidedFilters: [
      { shastra: "समयसार", gatha: 6, page: null, teeka: null },
      { shastra: "नियमसार", gatha: null, page: null, teeka: null },
    ],
    baseFilters: { content_type: ["Granth"], rerank: true },
    query: "मोक्ष",
    language: "hi",
    requestId: "r1",
    toolBudget: createToolBudget(5),
  });

  assert.equal(payloads.length, 3);
  assert.equal(payloads[0].granth, "Samaysaar");
  assert.equal(payloads[0].page_size, 3);
  assert.equal(payloads[0].page, 1);
  assert.equal(payloads[0].query, "मोक्ष");
  assert.equal(payloads[0].rerank, true);
  assert.equal(out.length, 3);
  assert.equal(out[0].guided_filter.shastra, "समयसार");
  assert.equal(out[0].results.length, 1);
});

test("fetchGuidedResults stops when tool budget is exhausted", async () => {
  // Use Hindi-mapped shastras: समयसार→2, नियमसार→1; budget=1 stops after first call.
  let calls = 0;
  const externalApi = { search: async () => { calls += 1; return []; } };
  const out = await fetchGuidedResults({
    externalApi,
    guidedFilters: [{ shastra: "समयसार" }, { shastra: "नियमसार" }, { shastra: "प्रवचनसार" }],
    query: "q",
    toolBudget: createToolBudget(1),
  });
  assert.equal(calls, 1);
  assert.equal(out.length, 1);
});

test("fetchGuidedResults skips a filter whose search throws", async () => {
  const externalApi = {
    search: async (payload) => {
      if (payload.granth === "Niyamsaar") throw new Error("boom");
      return [{ chunk_id: "ok" }];
    },
  };
  // नियमसार→Niyamsaar throws; समयसार→2 calls both succeed.
  const out = await fetchGuidedResults({
    externalApi,
    guidedFilters: [{ shastra: "नियमसार" }, { shastra: "समयसार" }],
    query: "q",
    toolBudget: createToolBudget(5),
  });
  assert.equal(out.length, 2);
  assert.ok(out.every((r) => r.guided_filter.shastra === "समयसार"));
});

test("resolveGranthNames maps a Hindi name to all english_names", () => {
  // समयसार maps to both "Samaysaar" and "Samaysaar Kalash Tika".
  assert.deepEqual(resolveGranthNames("समयसार"), ["Samaysaar", "Samaysaar Kalash Tika"]);
  // नियमसार maps to a single english_name.
  assert.deepEqual(resolveGranthNames("नियमसार"), ["Niyamsaar"]);
  // Unmapped value returns empty (no API call should fire).
  assert.deepEqual(resolveGranthNames("samaysaar"), []);
  assert.deepEqual(resolveGranthNames(null), []);
});

test("fetchGuidedResults fires one search per matched english_name for a Hindi shastra", async () => {
  const granths = [];
  const externalApi = {
    search: async (payload) => { granths.push(payload.granth); return [{ chunk_id: "g" }]; },
  };
  const out = await fetchGuidedResults({
    externalApi,
    guidedFilters: [{ shastra: "समयसार", gatha: 6 }],
    query: "मोक्ष",
    toolBudget: createToolBudget(5),
  });
  assert.deepEqual(granths, ["Samaysaar", "Samaysaar Kalash Tika"]);
  assert.equal(out.length, 2);
  assert.equal(out[0].guided_filter.shastra, "समयसार");
  assert.equal(out[0].granth, "Samaysaar");
  assert.equal(out[1].granth, "Samaysaar Kalash Tika");
});

test("fetchGuidedResults skips filter when shastra has no english_name mapping", async () => {
  let calls = 0;
  const externalApi = { search: async () => { calls += 1; return []; } };
  // "samaysaar" (Latin) has no mapping; "समयसार" (Hindi) does.
  const out = await fetchGuidedResults({
    externalApi,
    guidedFilters: [{ shastra: "samaysaar" }, { shastra: "समयसार" }],
    query: "q",
    toolBudget: createToolBudget(5),
  });
  // Only the Hindi-mapped shastra fires calls (2 english_names for समयसार).
  assert.equal(calls, 2);
  assert.equal(out.length, 2);
  assert.ok(out.every((r) => r.guided_filter.shastra === "समयसार"));
});

test("fetchGuidedResults stops mid-filter when budget exhausts across english_names", async () => {
  let calls = 0;
  const externalApi = { search: async () => { calls += 1; return []; } };
  const out = await fetchGuidedResults({
    externalApi,
    guidedFilters: [{ shastra: "समयसार" }],
    query: "q",
    toolBudget: createToolBudget(1),
  });
  assert.equal(calls, 1);
  assert.equal(out.length, 1);
});

// ─── verse filters (gatha/shlok/doha/kavya/sutra) ─────────────────────────────

test("resolveGranthFilters derives verse field from gatha_identifier (non-adhikaar)", () => {
  // आत्मानुशासन → Atmanushashan, gatha_identifier "श्लोक", no adhikaar → shlok.
  assert.deepEqual(resolveGranthFilters("आत्मानुशासन"), [
    { granth: "Atmanushashan", verseField: "shlok" },
  ]);
  // इष्टोपदेश has both Granth + Pravachan entries, both श्लोक.
  assert.deepEqual(resolveGranthFilters("इष्टोपदेश"), [
    { granth: "Ishtopadesh", verseField: "shlok" },
  ]);
});

test("resolveGranthFilters returns null verseField for adhikaar-scoped shastras", () => {
  // परमात्मप्रकाश has includes_adhikaar: true → no verse field.
  assert.deepEqual(resolveGranthFilters("परमात्मप्रकाश"), [
    { granth: "Parmatma Prakash", verseField: null },
  ]);
});

test("resolveGranthFilters defaults verseField to gatha when gatha_identifier absent", () => {
  // समयसार → 2 english_names, neither has a gatha_identifier nor adhikaar, so
  // the verse field defaults to gatha.
  assert.deepEqual(resolveGranthFilters("समयसार"), [
    { granth: "Samaysaar", verseField: "gatha" },
    { granth: "Samaysaar Kalash Tika", verseField: "gatha" },
  ]);
});

test("resolveGranthFilters returns null verseField for unmapped identifier token", () => {
  // जैन सिद्धांत प्रवेशिका gatha_identifier "प्रश्न" has no agent verse field.
  assert.deepEqual(resolveGranthFilters("जैन सिद्धांत प्रवेशिका"), [
    { granth: "Jain Siddhant Praveshika", verseField: null },
  ]);
});

test("fetchGuidedResults passes verse filter for non-adhikaar shastra with gatha", async () => {
  let captured;
  const externalApi = { search: async (p) => { captured = p; return [{ chunk_id: "g" }]; } };
  const out = await fetchGuidedResults({
    externalApi,
    guidedFilters: [{ shastra: "आत्मानुशासन", gatha: 12 }],
    query: "q",
    toolBudget: createToolBudget(5),
  });
  assert.equal(captured.granth, "Atmanushashan");
  assert.equal(captured.shlok, "12");
  assert.equal(captured.gatha, undefined);
  assert.deepEqual(out[0].verse_filter, { shlok: "12" });
});

test("fetchGuidedResults omits verse filter when shastra is adhikaar-scoped", async () => {
  let captured;
  const externalApi = { search: async (p) => { captured = p; return []; } };
  await fetchGuidedResults({
    externalApi,
    guidedFilters: [{ shastra: "परमात्मप्रकाश", gatha: 6 }],
    query: "q",
    toolBudget: createToolBudget(5),
  });
  assert.equal(captured.granth, "Parmatma Prakash");
  assert.equal(captured.shlok, undefined);
  assert.equal(captured.gatha, undefined);
});

test("fetchGuidedResults omits verse filter when gatha is null", async () => {
  let captured;
  const externalApi = { search: async (p) => { captured = p; return []; } };
  await fetchGuidedResults({
    externalApi,
    guidedFilters: [{ shastra: "आत्मानुशासन", gatha: null }],
    query: "q",
    toolBudget: createToolBudget(5),
  });
  assert.equal(captured.granth, "Atmanushashan");
  assert.equal(captured.shlok, undefined);
});

test("fetchGuidedResults honours KB_GUIDED_PAGE_SIZE env override", async () => {
  const prev = process.env.KB_GUIDED_PAGE_SIZE;
  process.env.KB_GUIDED_PAGE_SIZE = "7";
  try {
    let captured;
    const externalApi = { search: async (p) => { captured = p; return []; } };
    await fetchGuidedResults({
      externalApi,
      guidedFilters: [{ shastra: "नियमसार" }],
      query: "q",
      toolBudget: createToolBudget(5),
    });
    assert.equal(captured.page_size, 7);
  } finally {
    if (prev === undefined) delete process.env.KB_GUIDED_PAGE_SIZE;
    else process.env.KB_GUIDED_PAGE_SIZE = prev;
  }
});
