import { test } from "node:test";
import assert from "node:assert/strict";

import { KbApiClient } from "../../src/kb_api/client.js";

function mockFetch(responseText, { ok = true, status = 200 } = {}) {
  const original = global.fetch;
  const calls = [];
  global.fetch = async (url, options) => {
    calls.push({ url, options });
    return { ok, status, text: async () => responseText };
  };
  return { calls, restore: () => { global.fetch = original; } };
}

// ─── shastras ────────────────────────────────────────────────────────────────

test("KbApiClient.shastras: issues GET with correct URL and query params", async () => {
  const { calls, restore } = mockFetch(JSON.stringify([{ name: "समयसार", natural_key: "samaysaar", similarity: 0.9 }]));
  try {
    const client = new KbApiClient({ baseUrl: "http://kb.example.com", timeoutMs: 200 });
    const result = await client.shastras({ q: "samaysaar", fuzzy: true, limit: 5 }, "r1");

    assert.equal(calls.length, 1);
    assert.ok(calls[0].url.startsWith("http://kb.example.com/v1/shastras?"), "correct path");
    assert.ok(calls[0].url.includes("q=samaysaar"), "q param present");
    assert.ok(calls[0].url.includes("fuzzy=true"), "fuzzy param present");
    assert.ok(calls[0].url.includes("limit=5"), "limit param present");
    assert.equal(calls[0].options.method, "GET", "uses GET");
    assert.equal(result.length, 1);
    assert.equal(result[0].natural_key, "samaysaar");
  } finally {
    restore();
  }
});

test("KbApiClient.shastras: sends X-Chat-Request-Id header", async () => {
  const { calls, restore } = mockFetch("[]");
  try {
    const client = new KbApiClient({ baseUrl: "http://kb.example.com", timeoutMs: 200 });
    await client.shastras({ q: "samaysaar" }, "req-123");

    assert.equal(calls[0].options.headers["X-Chat-Request-Id"], "req-123");
  } finally {
    restore();
  }
});

test("KbApiClient.shastras: returns empty array on empty response body", async () => {
  const { restore } = mockFetch("");
  try {
    const client = new KbApiClient({ baseUrl: "http://kb.example.com", timeoutMs: 200 });
    const result = await client.shastras({ q: "x" }, "r1");
    assert.deepEqual(result, []);
  } finally {
    restore();
  }
});

test("KbApiClient.shastras: throws on non-ok HTTP response", async () => {
  const { restore } = mockFetch("Not Found", { ok: false, status: 404 });
  try {
    const client = new KbApiClient({ baseUrl: "http://kb.example.com", timeoutMs: 200 });
    await assert.rejects(() => client.shastras({ q: "x" }, "r1"), /KB API.*failed.*404/);
  } finally {
    restore();
  }
});

// ─── authors ─────────────────────────────────────────────────────────────────

test("KbApiClient.authors: issues GET with correct URL and query params", async () => {
  const { calls, restore } = mockFetch(JSON.stringify([{ name: "Kundkund", natural_key: "kundkund", similarity: 0.8 }]));
  try {
    const client = new KbApiClient({ baseUrl: "http://kb.example.com", timeoutMs: 200 });
    const result = await client.authors({ q: "kundkund", fuzzy: true, limit: 5 }, "r1");

    assert.ok(calls[0].url.includes("/v1/authors?"), "correct path");
    assert.ok(calls[0].url.includes("q=kundkund"), "q param present");
    assert.equal(calls[0].options.method, "GET");
    assert.equal(result[0].natural_key, "kundkund");
  } finally {
    restore();
  }
});

// ─── teekas ──────────────────────────────────────────────────────────────────

test("KbApiClient.teekas: issues GET with correct URL and query params", async () => {
  const { calls, restore } = mockFetch(JSON.stringify([{ name: "Amritchandra Teeka", natural_key: "amritchandra_teeka", similarity: 0.75 }]));
  try {
    const client = new KbApiClient({ baseUrl: "http://kb.example.com", timeoutMs: 200 });
    const result = await client.teekas({ q: "amritchandra", fuzzy: true, limit: 3 }, "r1");

    assert.ok(calls[0].url.includes("/v1/teekas?"), "correct path");
    assert.ok(calls[0].url.includes("q=amritchandra"), "q param present");
    assert.ok(calls[0].url.includes("limit=3"), "limit param present");
    assert.equal(result[0].natural_key, "amritchandra_teeka");
  } finally {
    restore();
  }
});

// ─── defaults ────────────────────────────────────────────────────────────────

test("KbApiClient.shastras: uses fuzzy=true and limit=5 as defaults", async () => {
  const { calls, restore } = mockFetch("[]");
  try {
    const client = new KbApiClient({ baseUrl: "http://kb.example.com", timeoutMs: 200 });
    await client.shastras({ q: "samaysaar" }, "r1");

    assert.ok(calls[0].url.includes("fuzzy=true"), "default fuzzy=true");
    assert.ok(calls[0].url.includes("limit=5"), "default limit=5");
  } finally {
    restore();
  }
});

// ─── gathaDetail ─────────────────────────────────────────────────────────────

test("KbApiClient.gathaDetail: issues GET with correct URL and params", async () => {
  const payload = { gatha_number: 6, prakrit: "तेरे लोय...", sanskrit: "त्रय लोक..." };
  const { calls, restore } = mockFetch(JSON.stringify(payload));
  try {
    const client = new KbApiClient({ baseUrl: "http://kb.example.com", timeoutMs: 200 });
    const result = await client.gathaDetail({ shastra: "samaysaar", number: 6 }, "r1");

    assert.equal(calls.length, 1);
    assert.ok(calls[0].url.startsWith("http://kb.example.com/v1/gathas?"), "correct path");
    assert.ok(calls[0].url.includes("shastra=samaysaar"), "shastra param present");
    assert.ok(calls[0].url.includes("number=6"), "number param present");
    assert.equal(calls[0].options.method, "GET");
    assert.equal(result.gatha_number, 6);
    assert.equal(result.prakrit, "तेरे लोय...");
  } finally {
    restore();
  }
});

test("KbApiClient.gathaDetail: sends X-Chat-Request-Id header", async () => {
  const { calls, restore } = mockFetch(JSON.stringify({}));
  try {
    const client = new KbApiClient({ baseUrl: "http://kb.example.com", timeoutMs: 200 });
    await client.gathaDetail({ shastra: "samaysaar", number: 1 }, "req-abc");

    assert.equal(calls[0].options.headers["X-Chat-Request-Id"], "req-abc");
  } finally {
    restore();
  }
});

test("KbApiClient.gathaDetail: throws on non-ok HTTP response", async () => {
  const { restore } = mockFetch("Not Found", { ok: false, status: 404 });
  try {
    const client = new KbApiClient({ baseUrl: "http://kb.example.com", timeoutMs: 200 });
    await assert.rejects(() => client.gathaDetail({ shastra: "samaysaar", number: 6 }, "r1"), /KB API.*failed.*404/);
  } finally {
    restore();
  }
});

// ─── topicsInShastra ─────────────────────────────────────────────────────────

test("KbApiClient.topicsInShastra: issues POST with body params", async () => {
  const { calls, restore } = mockFetch(JSON.stringify({ topics: [{ topic_natural_key: "आत्मा/स्वरूप", mention_count: 3 }], tool_trace_id: "t1" }));
  try {
    const client = new KbApiClient({ baseUrl: "http://kb.example.com", timeoutMs: 200 });
    const result = await client.topicsInShastra({ shastra: "samaysaar", gathaNumber: 6, limit: 10 }, "r1");

    assert.ok(calls[0].url.includes("/v1/query/topics_in_shastra"), "correct path");
    assert.ok(!calls[0].url.includes("?"), "no query string in URL");
    assert.equal(calls[0].options.method, "POST");
    const body = JSON.parse(calls[0].options.body);
    assert.equal(body.shastra_natural_key, "samaysaar", "shastra_natural_key in body");
    assert.equal(body.gatha_number, 6, "gatha_number in body");
    assert.equal(body.limit, 10, "limit in body");
    assert.equal(result[0].topic_natural_key, "आत्मा/स्वरूप");
  } finally {
    restore();
  }
});

test("KbApiClient.topicsInShastra: omits gatha_number from body when null", async () => {
  const { calls, restore } = mockFetch(JSON.stringify({ topics: [], tool_trace_id: "t1" }));
  try {
    const client = new KbApiClient({ baseUrl: "http://kb.example.com", timeoutMs: 200 });
    await client.topicsInShastra({ shastra: "samaysaar", gathaNumber: null, limit: 25 }, "r1");

    const body = JSON.parse(calls[0].options.body);
    assert.ok(!("gatha_number" in body), "gatha_number absent from body when null");
  } finally {
    restore();
  }
});

test("KbApiClient.topicsInShastra: uses limit=25 as default", async () => {
  const { calls, restore } = mockFetch(JSON.stringify({ topics: [], tool_trace_id: "t1" }));
  try {
    const client = new KbApiClient({ baseUrl: "http://kb.example.com", timeoutMs: 200 });
    await client.topicsInShastra({ shastra: "samaysaar" }, "r1");

    const body = JSON.parse(calls[0].options.body);
    assert.equal(body.limit, 25, "default limit=25");
  } finally {
    restore();
  }
});

// ─── keywordResolveBatch ──────────────────────────────────────────────────────

test("KbApiClient.keywordResolveBatch: unwraps resolutions array from response object", async () => {
  const body = {
    resolutions: [
      { input_token: "आत्मा", keyword_natural_key: "आत्मा", match_kind: "exact", suggestions: [], definitions: [] },
    ],
    tool_trace_id: "t1",
  };
  const { calls, restore } = mockFetch(JSON.stringify(body));
  try {
    const client = new KbApiClient({ baseUrl: "http://kb.example.com", timeoutMs: 200 });
    const result = await client.keywordResolveBatch(["आत्मा"], { fuzzyTopK: 0, includeDefinitions: true }, "r1");

    assert.ok(calls[0].url.includes("/v1/query/keyword_resolve_batch"), "correct path");
    assert.equal(calls[0].options.method, "POST");
    const reqBody = JSON.parse(calls[0].options.body);
    assert.deepEqual(reqBody.tokens, ["आत्मा"], "tokens in body");
    assert.ok(Array.isArray(result), "returns an array, not the wrapper object");
    assert.equal(result.length, 1);
    assert.equal(result[0].keyword_natural_key, "आत्मा");
  } finally {
    restore();
  }
});

test("KbApiClient.keywordResolveBatch: returns [] when resolutions missing", async () => {
  const { restore } = mockFetch(JSON.stringify({ tool_trace_id: "t1" }));
  try {
    const client = new KbApiClient({ baseUrl: "http://kb.example.com", timeoutMs: 200 });
    const result = await client.keywordResolveBatch(["x"], {}, "r1");
    assert.deepEqual(result, []);
  } finally {
    restore();
  }
});

test("KbApiClient.topicsMatch: sends content_only when requested", async () => {
  const { calls, restore } = mockFetch(JSON.stringify({ matches: [], tool_trace_id: "t1" }));
  try {
    const client = new KbApiClient({ baseUrl: "http://kb.example.com", timeoutMs: 200 });
    await client.topicsMatch(
      { keywords: ["आत्मा"], limit: 5, contentOnly: true, includeExtracts: true, includeReferences: true },
      "r-topics-match"
    );

    const body = JSON.parse(calls[0].options.body);
    assert.equal(body.content_only, true);
    assert.equal(body.include_extracts, true);
    assert.equal(body.include_references, true);
  } finally {
    restore();
  }
});

test("KbApiClient.topicNeighbors: sends max_hops and extract hydration flags", async () => {
  const { calls, restore } = mockFetch(JSON.stringify({ neighbors_by_anchor: [], tool_trace_id: "t1" }));
  try {
    const client = new KbApiClient({ baseUrl: "http://kb.example.com", timeoutMs: 200 });
    await client.topicNeighbors(
      {
        topicNaturalKeys: ["आत्मा"],
        maxNeighborsPerTopic: 10,
        maxHops: 2,
        includeExtracts: true,
        includeReferences: true,
      },
      "r-topic-neighbors"
    );

    const body = JSON.parse(calls[0].options.body);
    assert.deepEqual(body.topic_natural_keys, ["आत्मा"]);
    assert.equal(body.max_neighbors_per_topic, 10);
    assert.equal(body.max_hops, 2);
    assert.equal(body.include_extracts, true);
    assert.equal(body.include_references, true);
  } finally {
    restore();
  }
});

// ─── shastrasForTopic ─────────────────────────────────────────────────────────

test("KbApiClient.shastrasForTopic: issues POST with body params", async () => {
  const { calls, restore } = mockFetch(JSON.stringify({ topic_natural_key: "द्रव्य/स्वतंत्रता", shastras: [{ shastra_natural_key: "samaysaar", name_hi: "समयसार", total_mentions: 5, gathas: [] }], tool_trace_id: "t1" }));
  try {
    const client = new KbApiClient({ baseUrl: "http://kb.example.com", timeoutMs: 200 });
    const result = await client.shastrasForTopic({ topicNaturalKey: "द्रव्य/स्वतंत्रता", limitShastras: 5, limitGathasPerShastra: 5 }, "r1");

    assert.ok(calls[0].url.includes("/v1/query/shastras_for_topic"), "correct path");
    assert.ok(!calls[0].url.includes("?"), "no query string in URL");
    assert.equal(calls[0].options.method, "POST");
    const body = JSON.parse(calls[0].options.body);
    assert.equal(body.topic_natural_key, "द्रव्य/स्वतंत्रता", "topic_natural_key in body");
    assert.equal(body.limit_shastras, 5, "limit_shastras in body");
    assert.equal(body.limit_gathas_per_shastra, 5, "limit_gathas_per_shastra in body");
    assert.equal(result[0].shastra_natural_key, "samaysaar");
  } finally {
    restore();
  }
});

test("KbApiClient.shastrasForTopic: uses limit defaults", async () => {
  const { calls, restore } = mockFetch(JSON.stringify({ topic_natural_key: "द्रव्य", shastras: [], tool_trace_id: "t1" }));
  try {
    const client = new KbApiClient({ baseUrl: "http://kb.example.com", timeoutMs: 200 });
    await client.shastrasForTopic({ topicNaturalKey: "द्रव्य" }, "r1");

    const body = JSON.parse(calls[0].options.body);
    assert.equal(body.limit_shastras, 10, "default limit_shastras=10");
    assert.equal(body.limit_gathas_per_shastra, 10, "default limit_gathas_per_shastra=10");
  } finally {
    restore();
  }
});

// ─── real-shape contract tests (verified against live core-service 8001 /
//     query-service 8004) ───────────────────────────────────────────────────

test("KbApiClient.shastras: unwraps {items} envelope and normalizes name from title[]", async () => {
  const { restore } = mockFetch(JSON.stringify({
    items: [
      { natural_key: "समयसार", title: [{ lang: "hin", script: "Deva", text: "समयसार" }], similarity: 1.0 },
    ],
    pagination: { total: 1 },
  }));
  try {
    const client = new KbApiClient({ baseUrl: "http://kb.example.com", timeoutMs: 200 });
    const result = await client.shastras({ q: "समयसार" }, "r1");
    assert.equal(result.length, 1, "items unwrapped to array");
    assert.equal(result[0].name, "समयसार", "name derived from title[].text");
    assert.equal(result[0].natural_key, "समयसार");
    assert.equal(result[0].similarity, 1.0);
  } finally {
    restore();
  }
});

test("KbApiClient.authors: normalizes name from display_name[]", async () => {
  const { restore } = mockFetch(JSON.stringify({
    items: [
      { natural_key: "कुन्दकुन्दाचार्य", display_name: [{ lang: "hin", text: "कुन्दकुन्दाचार्य" }], similarity: 0.57 },
    ],
    pagination: {},
  }));
  try {
    const client = new KbApiClient({ baseUrl: "http://kb.example.com", timeoutMs: 200 });
    const result = await client.authors({ q: "कुन्द" }, "r1");
    assert.equal(result[0].name, "कुन्दकुन्दाचार्य", "name derived from display_name[].text");
  } finally {
    restore();
  }
});

test("KbApiClient.topicNeighbors: converts list response to map keyed by anchor_topic_natural_key", async () => {
  const { restore } = mockFetch(JSON.stringify({
    neighbors_by_anchor: [
      {
        anchor_topic_natural_key: "द्रव्य:लक्षण",
        related_topics: [{ topic_natural_key: "गुण", display_text_hi: "गुण" }],
        related_keywords: [],
        mentioned_in_gathas: [{ shastra_natural_key: "समयसार", gatha_number: null }],
      },
    ],
    unresolved_topic_keys: [],
    tool_trace_id: "t1",
  }));
  try {
    const client = new KbApiClient({ baseUrl: "http://kb.example.com", timeoutMs: 200 });
    const map = await client.topicNeighbors({ topicNaturalKeys: ["द्रव्य:लक्षण"] }, "r1");
    assert.ok(!Array.isArray(map), "returns an object map, not a list");
    assert.ok(map["द्रव्य:लक्षण"], "keyed by anchor_topic_natural_key");
    assert.equal(map["द्रव्य:लक्षण"].related_topics.length, 1);
    assert.equal(map["द्रव्य:लक्षण"].mentioned_in_gathas[0].gatha_number, null, "null gatha_number tolerated");
  } finally {
    restore();
  }
});

test("KbApiClient.topicNeighbors: tolerates legacy object-map response", async () => {
  const { restore } = mockFetch(JSON.stringify({
    neighbors_by_anchor: { "द्रव्य:लक्षण": { related_topics: [] } },
    tool_trace_id: "t1",
  }));
  try {
    const client = new KbApiClient({ baseUrl: "http://kb.example.com", timeoutMs: 200 });
    const map = await client.topicNeighbors({ topicNaturalKeys: ["द्रव्य:लक्षण"] }, "r1");
    assert.ok(map["द्रव्य:लक्षण"], "object-map passed through");
  } finally {
    restore();
  }
});
