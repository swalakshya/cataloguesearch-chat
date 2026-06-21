import { test } from "node:test";
import assert from "node:assert/strict";

import {
  collectUsedJainKeywords,
  fetchKbDefinitions,
  formatKbDefinitionsContext,
} from "../../src/orchestrator/kb_definitions.js";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeKbClient({ resolveWith = [], shouldThrow = false } = {}) {
  const calls = [];
  return {
    calls,
    keywordResolveBatch: async (tokens, opts, requestId) => {
      calls.push({ tokens, opts, requestId });
      if (shouldThrow) throw new Error("KB unavailable");
      return resolveWith;
    },
  };
}

function makeKeywordResult(overrides = {}) {
  return {
    workflow: "basic_question_v1",
    keywords: ["आत्मा", "स्वरूप"],
    jain_keywords: ["आत्मा", "द्रव्य"],
    normal_keywords: ["स्वरूप"],
    ...overrides,
  };
}

function makeResolvedItem(overrides = {}) {
  return {
    input_token: "आत्मा",
    keyword_natural_key: "आत्मा",
    match_kind: "exact",
    definitions: [{ text_hi: "आत्मा का स्वरूप चेतन है।" }],
    ...overrides,
  };
}

// ─── collectUsedJainKeywords ──────────────────────────────────────────────────

test("collectUsedJainKeywords: returns jain_keywords from keywordResult", () => {
  const result = collectUsedJainKeywords(
    makeKeywordResult({ jain_keywords: ["आत्मा", "द्रव्य"] }),
    []
  );
  assert.deepEqual(result, ["आत्मा", "द्रव्य"]);
});

test("collectUsedJainKeywords: unions matched_seed_keywords from mergedTopics", () => {
  const mergedTopics = [
    { topic_natural_key: "आत्मा/स्वरूप", matched_seed_keywords: ["कर्म", "बंध"] },
    { topic_natural_key: "द्रव्य/स्वतंत्रता", matched_seed_keywords: ["परिणाम"] },
  ];
  const result = collectUsedJainKeywords(
    makeKeywordResult({ jain_keywords: ["आत्मा"] }),
    mergedTopics
  );
  assert.deepEqual(result, ["आत्मा", "कर्म", "बंध", "परिणाम"]);
});

test("collectUsedJainKeywords: deduplicates across jain_keywords and seed keywords", () => {
  const mergedTopics = [
    { matched_seed_keywords: ["आत्मा", "द्रव्य", "आत्मा"] },
  ];
  const result = collectUsedJainKeywords(
    makeKeywordResult({ jain_keywords: ["आत्मा", "द्रव्य"] }),
    mergedTopics
  );
  assert.deepEqual(result, ["आत्मा", "द्रव्य"]);
});

test("collectUsedJainKeywords: caps at KB_DEFINITIONS_MAX_KEYWORDS env var", () => {
  const original = process.env.KB_DEFINITIONS_MAX_KEYWORDS;
  process.env.KB_DEFINITIONS_MAX_KEYWORDS = "3";
  try {
    const result = collectUsedJainKeywords(
      makeKeywordResult({ jain_keywords: ["आत्मा", "द्रव्य", "कर्म", "बंध", "मोक्ष"] }),
      []
    );
    assert.equal(result.length, 3);
  } finally {
    if (original === undefined) delete process.env.KB_DEFINITIONS_MAX_KEYWORDS;
    else process.env.KB_DEFINITIONS_MAX_KEYWORDS = original;
  }
});

test("collectUsedJainKeywords: empty jain_keywords and no topics → empty array", () => {
  const result = collectUsedJainKeywords(
    makeKeywordResult({ jain_keywords: [] }),
    []
  );
  assert.deepEqual(result, []);
});

test("collectUsedJainKeywords: null/missing jain_keywords treated as empty", () => {
  const result = collectUsedJainKeywords({ workflow: "basic_question_v1" }, []);
  assert.deepEqual(result, []);
});

test("collectUsedJainKeywords: topics without matched_seed_keywords are skipped", () => {
  const mergedTopics = [
    { topic_natural_key: "foo" },
    { topic_natural_key: "bar", matched_seed_keywords: null },
    { topic_natural_key: "baz", matched_seed_keywords: ["मोक्ष"] },
  ];
  const result = collectUsedJainKeywords(
    makeKeywordResult({ jain_keywords: [] }),
    mergedTopics
  );
  assert.deepEqual(result, ["मोक्ष"]);
});

test("collectUsedJainKeywords: default cap is 15", () => {
  const original = process.env.KB_DEFINITIONS_MAX_KEYWORDS;
  delete process.env.KB_DEFINITIONS_MAX_KEYWORDS;
  try {
    const many = Array.from({ length: 20 }, (_, i) => `kw${i}`);
    const result = collectUsedJainKeywords(
      makeKeywordResult({ jain_keywords: many }),
      []
    );
    assert.equal(result.length, 15);
  } finally {
    if (original !== undefined) process.env.KB_DEFINITIONS_MAX_KEYWORDS = original;
  }
});

// ─── formatKbDefinitionsContext ───────────────────────────────────────────────

test("formatKbDefinitionsContext: empty array → empty text, empty citations", () => {
  assert.deepEqual(formatKbDefinitionsContext([]), { text: "", citations: [] });
});

test("formatKbDefinitionsContext: null → empty text, empty citations", () => {
  assert.deepEqual(formatKbDefinitionsContext(null), { text: "", citations: [] });
});

test("formatKbDefinitionsContext: items with no definitions are skipped → empty text", () => {
  const items = [
    { input_token: "आत्मा", keyword_natural_key: "आत्मा", definitions: [] },
  ];
  assert.equal(formatKbDefinitionsContext(items).text, "");
});

test("formatKbDefinitionsContext: renders header and definition lines", () => {
  const { text } = formatKbDefinitionsContext([makeResolvedItem()]);
  assert.ok(text.startsWith("### KB Definitions (Hindi)"), "has header");
  assert.ok(text.includes("आत्मा (nk=आत्मा):"), "has keyword line");
  assert.ok(text.includes("1. आत्मा का स्वरूप चेतन है।"), "has numbered definition");
});

test("formatKbDefinitionsContext: multiple definitions numbered sequentially", () => {
  const items = [
    makeResolvedItem({
      definitions: [
        { text_hi: "first def" },
        { text_hi: "second def" },
      ],
    }),
  ];
  const { text } = formatKbDefinitionsContext(items);
  assert.ok(text.includes("1. first def"), "first numbered");
  assert.ok(text.includes("2. second def"), "second numbered");
});

test("formatKbDefinitionsContext: multiple keywords each rendered", () => {
  const items = [
    makeResolvedItem({ input_token: "आत्मा", keyword_natural_key: "आत्मा" }),
    makeResolvedItem({
      input_token: "द्रव्य",
      keyword_natural_key: "द्रव्य",
      definitions: [{ text_hi: "द्रव्य का अर्थ..." }],
    }),
  ];
  const { text } = formatKbDefinitionsContext(items);
  assert.ok(text.includes("आत्मा (nk=आत्मा):"), "first keyword present");
  assert.ok(text.includes("द्रव्य (nk=द्रव्य):"), "second keyword present");
});

test("formatKbDefinitionsContext: items with empty text_hi are skipped within a keyword", () => {
  const items = [
    makeResolvedItem({
      definitions: [
        { text_hi: "" },
        { text_hi: "valid def" },
      ],
    }),
  ];
  const { text } = formatKbDefinitionsContext(items);
  assert.ok(text.includes("1. valid def"), "valid def rendered");
  assert.ok(!text.includes("1. \n"), "empty def not rendered");
});

test("formatKbDefinitionsContext: falls back to text field when text_hi absent", () => {
  const items = [
    makeResolvedItem({
      definitions: [{ text: "fallback text" }],
    }),
  ];
  const { text } = formatKbDefinitionsContext(items);
  assert.ok(text.includes("1. fallback text"), "text field used as fallback");
});

test("formatKbDefinitionsContext: source_url tags a citable id and yields a citation", () => {
  const items = [
    makeResolvedItem({
      input_token: "आत्मा",
      keyword_natural_key: "आत्मा",
      source_url: "https://www.jainkosh.org/wiki/आत्मा",
    }),
  ];
  const { text, citations } = formatKbDefinitionsContext(items);
  assert.ok(text.includes("[KB-D-1] आत्मा (nk=आत्मा):"), "id tag embedded in text");
  assert.deepEqual(citations, [
    { id: "KB-D-1", label: "आत्मा", source_url: "https://www.jainkosh.org/wiki/आत्मा" },
  ]);
});

test("formatKbDefinitionsContext: keyword without source_url gets no id tag and no citation", () => {
  const { text, citations } = formatKbDefinitionsContext([makeResolvedItem()]);
  assert.ok(!text.includes("[KB-D-"), "no id tag when no source_url");
  assert.deepEqual(citations, []);
});

test("formatKbDefinitionsContext: ids are sequential only over citable keywords", () => {
  const items = [
    makeResolvedItem({ input_token: "आत्मा", keyword_natural_key: "आत्मा" }), // no url
    makeResolvedItem({
      input_token: "द्रव्य",
      keyword_natural_key: "द्रव्य",
      definitions: [{ text_hi: "d" }],
      source_url: "https://www.jainkosh.org/wiki/द्रव्य",
    }),
  ];
  const { text, citations } = formatKbDefinitionsContext(items);
  assert.equal(citations.length, 1);
  assert.equal(citations[0].id, "KB-D-1");
  assert.ok(text.includes("[KB-D-1] द्रव्य"));
});

// ─── fetchKbDefinitions ───────────────────────────────────────────────────────

test("fetchKbDefinitions: empty usedJainKeywords → no KB call, returns empty text", async () => {
  const client = makeKbClient();
  const result = await fetchKbDefinitions({ usedJainKeywords: [], kbApiClient: client, requestId: "r1" });
  assert.deepEqual(result, { text: "", citations: [] });
  assert.equal(client.calls.length, 0, "no KB call made");
});

test("fetchKbDefinitions: null usedJainKeywords → no KB call, returns empty text", async () => {
  const client = makeKbClient();
  const result = await fetchKbDefinitions({ usedJainKeywords: null, kbApiClient: client, requestId: "r1" });
  assert.deepEqual(result, { text: "", citations: [] });
  assert.equal(client.calls.length, 0, "no KB call made");
});

test("fetchKbDefinitions: calls keywordResolveBatch with fuzzyTopK=0 and includeDefinitions=true", async () => {
  const client = makeKbClient({ resolveWith: [makeResolvedItem()] });
  await fetchKbDefinitions({ usedJainKeywords: ["आत्मा"], kbApiClient: client, requestId: "r1" });
  assert.equal(client.calls.length, 1);
  assert.equal(client.calls[0].opts.fuzzyTopK, 0, "fuzzyTopK=0");
  assert.equal(client.calls[0].opts.includeDefinitions, true, "includeDefinitions=true");
});

test("fetchKbDefinitions: passes tokens correctly to batch call", async () => {
  const client = makeKbClient({ resolveWith: [] });
  await fetchKbDefinitions({ usedJainKeywords: ["आत्मा", "द्रव्य"], kbApiClient: client, requestId: "r1" });
  assert.deepEqual(client.calls[0].tokens, ["आत्मा", "द्रव्य"]);
});

test("fetchKbDefinitions: returns formatted section when definitions present", async () => {
  const client = makeKbClient({ resolveWith: [makeResolvedItem()] });
  const { text } = await fetchKbDefinitions({ usedJainKeywords: ["आत्मा"], kbApiClient: client, requestId: "r1" });
  assert.ok(text.includes("### KB Definitions (Hindi)"), "section header present");
  assert.ok(text.includes("आत्मा (nk=आत्मा):"), "keyword entry present");
});

test("fetchKbDefinitions: surfaces citations for keywords with source_url", async () => {
  const client = makeKbClient({
    resolveWith: [makeResolvedItem({ source_url: "https://www.jainkosh.org/wiki/आत्मा" })],
  });
  const { citations } = await fetchKbDefinitions({ usedJainKeywords: ["आत्मा"], kbApiClient: client, requestId: "r1" });
  assert.deepEqual(citations, [
    { id: "KB-D-1", label: "आत्मा", source_url: "https://www.jainkosh.org/wiki/आत्मा" },
  ]);
});

test("fetchKbDefinitions: KB returns empty array → returns empty text", async () => {
  const client = makeKbClient({ resolveWith: [] });
  const result = await fetchKbDefinitions({ usedJainKeywords: ["आत्मा"], kbApiClient: client, requestId: "r1" });
  assert.deepEqual(result, { text: "", citations: [] });
});

test("fetchKbDefinitions: KB throws → logs warn, returns empty text (graceful degradation)", async () => {
  const client = makeKbClient({ shouldThrow: true });
  const result = await fetchKbDefinitions({ usedJainKeywords: ["आत्मा"], kbApiClient: client, requestId: "r1" });
  assert.deepEqual(result, { text: "", citations: [] }, "graceful: returns empty on error");
});

test("fetchKbDefinitions: resolves uses definitionsPerKeyword from env", async () => {
  const original = process.env.KB_DEFINITIONS_PER_KEYWORD;
  process.env.KB_DEFINITIONS_PER_KEYWORD = "2";
  const client = makeKbClient({ resolveWith: [makeResolvedItem()] });
  try {
    await fetchKbDefinitions({ usedJainKeywords: ["आत्मा"], kbApiClient: client, requestId: "r1" });
    assert.equal(client.calls[0].opts.definitionsPerKeyword, 2, "env var respected");
  } finally {
    if (original === undefined) delete process.env.KB_DEFINITIONS_PER_KEYWORD;
    else process.env.KB_DEFINITIONS_PER_KEYWORD = original;
  }
});
