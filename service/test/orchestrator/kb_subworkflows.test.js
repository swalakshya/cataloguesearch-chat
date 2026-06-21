import { test } from "node:test";
import assert from "node:assert/strict";

import { runKbSubworkflows, formatKbSubworkflowsContext } from "../../src/orchestrator/kb_subworkflows.js";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeKbClient(overrides = {}) {
  return {
    shastras: async () => [{ natural_key: "samaysaar", name: "समयसार" }],
    gathaDetail: async () => ({ gatha_number: 6, prakrit: "तेरे लोय...", sanskrit: "त्रय लोक..." }),
    topicsInShastra: async () => [{ topic_natural_key: "द्रव्य/स्वरूप", mention_count: 3 }],
    shastrasForTopic: async () => [{ shastra: "समयसार", natural_key: "samaysaar", gathas: [6, 49] }],
    topicsMatch: async () => [{ topic_natural_key: "द्रव्य/स्वतंत्रता", score: 0.9 }],
    ...overrides,
  };
}

// ─── formatKbSubworkflowsContext ──────────────────────────────────────────────

test("formatKbSubworkflowsContext: empty array returns empty string", () => {
  assert.equal(formatKbSubworkflowsContext([]), "");
  assert.equal(formatKbSubworkflowsContext(null), "");
});

test("formatKbSubworkflowsContext: direct_retrieval — correct header and fields", () => {
  const result = {
    name: "direct_retrieval",
    shastra: "samaysaar",
    gatha_number: 6,
    data: { prakrit: "तेरे लोय...", sanskrit: "त्रय लोक..." },
  };
  const out = formatKbSubworkflowsContext([result]);
  assert.ok(out.startsWith("### KB Sub-workflow Results"), "section header present");
  assert.ok(out.includes("[direct_retrieval] samaysaar gatha 6:"), "entry header present");
  assert.ok(out.includes("prakrit: तेरे लोय..."), "prakrit field present");
  assert.ok(out.includes("sanskrit: त्रय लोक..."), "sanskrit field present");
});

test("formatKbSubworkflowsContext: search_topic_in_shastra — correct format with gatha", () => {
  const result = {
    name: "search_topic_in_shastra",
    shastra: "samaysaar",
    gatha_number: 6,
    topics: [
      { topic_natural_key: "द्रव्य/स्वरूप", mention_count: 3 },
      { topic_natural_key: "कर्म/बंध", mention_count: 1 },
    ],
  };
  const out = formatKbSubworkflowsContext([result]);
  assert.ok(out.includes("[search_topic_in_shastra] samaysaar gatha 6 topics:"), "entry header with gatha");
  assert.ok(out.includes("द्रव्य/स्वरूप (3)"), "topic with count present");
  assert.ok(out.includes("कर्म/बंध (1)"), "second topic present");
});

test("formatKbSubworkflowsContext: search_topic_in_shastra — omits gatha when null", () => {
  const result = {
    name: "search_topic_in_shastra",
    shastra: "samaysaar",
    gatha_number: null,
    topics: [{ topic_natural_key: "आत्मा/स्वरूप", mention_count: 5 }],
  };
  const out = formatKbSubworkflowsContext([result]);
  assert.ok(out.includes("[search_topic_in_shastra] samaysaar topics:"), "no gatha label when null");
  assert.ok(!out.includes("gatha"), "gatha word absent");
});

test("formatKbSubworkflowsContext: search_shastra_for_topics — correct format", () => {
  const result = {
    name: "search_shastra_for_topics",
    topic_natural_key: "द्रव्य/स्वतंत्रता",
    shastras: [
      { shastra: "समयसार", natural_key: "samaysaar", gathas: [6, 49] },
      { shastra: "प्रवचनसार", natural_key: "pravachansaar", gathas: [12] },
    ],
  };
  const out = formatKbSubworkflowsContext([result]);
  assert.ok(out.includes("[search_shastra_for_topics] topic = द्रव्य/स्वतंत्रता:"), "entry header present");
  assert.ok(out.includes("समयसार: gathas 6, 49"), "first shastra with gathas");
  assert.ok(out.includes("प्रवचनसार: gathas 12"), "second shastra with gathas");
});

test("formatKbSubworkflowsContext: multiple results — all rendered in order", () => {
  const results = [
    { name: "direct_retrieval", shastra: "samaysaar", gatha_number: 6, data: { prakrit: "xxx" } },
    { name: "search_topic_in_shastra", shastra: "samaysaar", gatha_number: 6, topics: [] },
  ];
  const out = formatKbSubworkflowsContext(results);
  const idx1 = out.indexOf("[direct_retrieval]");
  const idx2 = out.indexOf("[search_topic_in_shastra]");
  assert.ok(idx1 < idx2, "results rendered in input order");
});

test("formatKbSubworkflowsContext: topic with no mention_count — no count in output", () => {
  const result = {
    name: "search_topic_in_shastra",
    shastra: "samaysaar",
    gatha_number: 6,
    topics: [{ topic_natural_key: "द्रव्य" }],
  };
  const out = formatKbSubworkflowsContext([result]);
  assert.ok(out.includes("- द्रव्य\n") || out.includes("- द्रव्य"), "topic without count");
  assert.ok(!out.includes("(undefined)"), "no undefined count");
});

// ─── runKbSubworkflows — null/empty guards ────────────────────────────────────

test("runKbSubworkflows: returns [] when kbApiClient is null", async () => {
  const result = await runKbSubworkflows([{ name: "direct_retrieval", shastra: "samaysaar", gatha_number: 6, want: [] }], null, "r1");
  assert.deepEqual(result, []);
});

test("runKbSubworkflows: returns [] when kb_subworkflows is empty array", async () => {
  const result = await runKbSubworkflows([], makeKbClient(), "r1");
  assert.deepEqual(result, []);
});

test("runKbSubworkflows: returns [] when kb_subworkflows is null", async () => {
  const result = await runKbSubworkflows(null, makeKbClient(), "r1");
  assert.deepEqual(result, []);
});

// ─── runKbSubworkflows — direct_retrieval ────────────────────────────────────

test("runKbSubworkflows: direct_retrieval — calls shastras then gathaDetail", async () => {
  const calls = [];
  const kbClient = makeKbClient({
    shastras: async ({ q }) => { calls.push({ method: "shastras", q }); return [{ natural_key: "samaysaar" }]; },
    gathaDetail: async ({ shastra, number }) => { calls.push({ method: "gathaDetail", shastra, number }); return { prakrit: "P", bhaavarth: "B" }; },
  });

  const entries = [{ name: "direct_retrieval", shastra: "Samaysaar", gatha_number: 6, want: ["prakrit", "bhaavarth"] }];
  const results = await runKbSubworkflows(entries, kbClient, "r1");

  assert.equal(results.length, 1);
  assert.equal(results[0].name, "direct_retrieval");
  assert.equal(results[0].shastra, "samaysaar");
  assert.equal(results[0].gatha_number, 6);
  assert.deepEqual(results[0].data, { prakrit: "P", bhaavarth: "B" });
  const shastrasCall = calls.find((c) => c.method === "shastras");
  assert.ok(shastrasCall, "shastras called for canonicalization");
  const gathaCall = calls.find((c) => c.method === "gathaDetail");
  assert.equal(gathaCall.shastra, "samaysaar", "canonical key used for gathaDetail");
  assert.equal(gathaCall.number, 6);
});

test("runKbSubworkflows: direct_retrieval — projects only want fields", async () => {
  const kbClient = makeKbClient({
    gathaDetail: async () => ({ prakrit: "P", sanskrit: "S", bhaavarth: "B", teeka: "T" }),
  });
  const entries = [{ name: "direct_retrieval", shastra: "samaysaar", gatha_number: 6, want: ["sanskrit"] }];
  const results = await runKbSubworkflows(entries, kbClient, "r1");

  assert.deepEqual(Object.keys(results[0].data), ["sanskrit"], "only want fields projected");
});

test("runKbSubworkflows: direct_retrieval — uses default want fields when want is empty/null", async () => {
  const kbClient = makeKbClient({
    gathaDetail: async () => ({ prakrit: "P", sanskrit: "S", bhaavarth: "B", teeka: "T" }),
  });
  const entries = [{ name: "direct_retrieval", shastra: "samaysaar", gatha_number: 6, want: null }];
  const results = await runKbSubworkflows(entries, kbClient, "r1");

  const fields = Object.keys(results[0].data);
  assert.ok(fields.includes("prakrit"), "default includes prakrit");
  assert.ok(fields.includes("sanskrit"), "default includes sanskrit");
  assert.ok(fields.includes("bhaavarth"), "default includes bhaavarth");
});

test("runKbSubworkflows: direct_retrieval — returns null result when shastra missing", async () => {
  const kbClient = makeKbClient();
  const entries = [{ name: "direct_retrieval", shastra: null, gatha_number: 6, want: [] }];
  const results = await runKbSubworkflows(entries, kbClient, "r1");
  assert.deepEqual(results, [], "null entry dropped");
});

test("runKbSubworkflows: direct_retrieval — returns null result when gatha_number missing", async () => {
  const kbClient = makeKbClient();
  const entries = [{ name: "direct_retrieval", shastra: "samaysaar", gatha_number: null, want: [] }];
  const results = await runKbSubworkflows(entries, kbClient, "r1");
  assert.deepEqual(results, [], "null gatha_number entry dropped");
});

// ─── runKbSubworkflows — search_topic_in_shastra ──────────────────────────────

test("runKbSubworkflows: search_topic_in_shastra — calls shastras then topicsInShastra", async () => {
  const calls = [];
  const kbClient = makeKbClient({
    shastras: async () => { calls.push("shastras"); return [{ natural_key: "samaysaar" }]; },
    topicsInShastra: async ({ shastra, gathaNumber }) => {
      calls.push({ method: "topicsInShastra", shastra, gathaNumber });
      return [{ topic_natural_key: "द्रव्य", mention_count: 5 }];
    },
  });

  const entries = [{ name: "search_topic_in_shastra", shastra: "Samaysaar", gatha_number: 6, want: null, topic: null }];
  const results = await runKbSubworkflows(entries, kbClient, "r1");

  assert.equal(results.length, 1);
  assert.equal(results[0].name, "search_topic_in_shastra");
  assert.equal(results[0].shastra, "samaysaar");
  assert.equal(results[0].gatha_number, 6);
  assert.equal(results[0].topics.length, 1);
  assert.equal(results[0].topics[0].topic_natural_key, "द्रव्य");
  const tIsCall = calls.find((c) => c?.method === "topicsInShastra");
  assert.equal(tIsCall.gathaNumber, 6, "gatha_number passed through");
});

test("runKbSubworkflows: search_topic_in_shastra — passes null gatha_number", async () => {
  let capturedGathaNumber;
  const kbClient = makeKbClient({
    topicsInShastra: async ({ gathaNumber }) => { capturedGathaNumber = gathaNumber; return []; },
  });
  const entries = [{ name: "search_topic_in_shastra", shastra: "samaysaar", gatha_number: null, want: null, topic: null }];
  await runKbSubworkflows(entries, kbClient, "r1");
  assert.equal(capturedGathaNumber, null);
});

// ─── runKbSubworkflows — search_shastra_for_topics ────────────────────────────

test("runKbSubworkflows: search_shastra_for_topics — calls topicsMatch then shastrasForTopic", async () => {
  const calls = [];
  const kbClient = makeKbClient({
    topicsMatch: async ({ keywords }) => { calls.push({ method: "topicsMatch", keywords }); return [{ topic_natural_key: "द्रव्य/स्वतंत्रता" }]; },
    shastrasForTopic: async ({ topicNaturalKey }) => { calls.push({ method: "shastrasForTopic", topicNaturalKey }); return [{ shastra: "समयसार", gathas: [6] }]; },
  });

  const entries = [{ name: "search_shastra_for_topics", shastra: null, gatha_number: null, want: null, topic: "द्रव्य" }];
  const results = await runKbSubworkflows(entries, kbClient, "r1");

  assert.equal(results.length, 1);
  assert.equal(results[0].name, "search_shastra_for_topics");
  assert.equal(results[0].topic_natural_key, "द्रव्य/स्वतंत्रता", "topicsMatch result used as canonical key");
  assert.equal(results[0].shastras.length, 1);
  const sfCall = calls.find((c) => c?.method === "shastrasForTopic");
  assert.equal(sfCall.topicNaturalKey, "द्रव्य/स्वतंत्रता", "canonical key from topicsMatch passed to shastrasForTopic");
});

test("runKbSubworkflows: search_shastra_for_topics — falls back to raw topic when topicsMatch returns empty", async () => {
  let capturedKey;
  const kbClient = makeKbClient({
    topicsMatch: async () => [],
    shastrasForTopic: async ({ topicNaturalKey }) => { capturedKey = topicNaturalKey; return []; },
  });

  const entries = [{ name: "search_shastra_for_topics", shastra: null, gatha_number: null, want: null, topic: "द्रव्य/स्वतंत्रता" }];
  await runKbSubworkflows(entries, kbClient, "r1");
  assert.equal(capturedKey, "द्रव्य/स्वतंत्रता", "raw topic used when topicsMatch returns empty");
});

test("runKbSubworkflows: search_shastra_for_topics — returns null when topic missing", async () => {
  const kbClient = makeKbClient();
  const entries = [{ name: "search_shastra_for_topics", shastra: null, gatha_number: null, want: null, topic: null }];
  const results = await runKbSubworkflows(entries, kbClient, "r1");
  assert.deepEqual(results, []);
});

// ─── runKbSubworkflows — cap enforcement ─────────────────────────────────────

test("runKbSubworkflows: caps at KB_SUBWORKFLOWS_MAX entries (default 4)", async () => {
  const dispatched = [];
  const kbClient = makeKbClient({
    gathaDetail: async (args) => { dispatched.push(args); return {}; },
  });

  const entries = Array.from({ length: 6 }, (_, i) => ({
    name: "direct_retrieval",
    shastra: "samaysaar",
    gatha_number: i + 1,
    want: [],
    topic: null,
  }));

  const originalMax = process.env.KB_SUBWORKFLOWS_MAX;
  process.env.KB_SUBWORKFLOWS_MAX = "3";
  try {
    const results = await runKbSubworkflows(entries, kbClient, "r1");
    assert.ok(results.length <= 3, `got ${results.length} results, expected at most 3`);
  } finally {
    if (originalMax === undefined) delete process.env.KB_SUBWORKFLOWS_MAX;
    else process.env.KB_SUBWORKFLOWS_MAX = originalMax;
  }
});

// ─── runKbSubworkflows — timeout ─────────────────────────────────────────────

test("runKbSubworkflows: times out slow sub-workflow and drops it from results", async () => {
  const kbClient = makeKbClient({
    shastras: async () => [{ natural_key: "samaysaar" }],
    gathaDetail: async () => {
      await new Promise((resolve) => setTimeout(resolve, 200));
      return { prakrit: "late" };
    },
  });

  const entries = [{ name: "direct_retrieval", shastra: "samaysaar", gatha_number: 6, want: [], topic: null }];
  const originalTimeout = process.env.KB_SUBWORKFLOW_TIMEOUT_MS;
  process.env.KB_SUBWORKFLOW_TIMEOUT_MS = "50";
  try {
    const results = await runKbSubworkflows(entries, kbClient, "r1");
    assert.deepEqual(results, [], "timed-out entry dropped from results");
  } finally {
    if (originalTimeout === undefined) delete process.env.KB_SUBWORKFLOW_TIMEOUT_MS;
    else process.env.KB_SUBWORKFLOW_TIMEOUT_MS = originalTimeout;
  }
});

// ─── runKbSubworkflows — error resilience ─────────────────────────────────────

test("runKbSubworkflows: one failing sub-workflow does not block others", async () => {
  const kbClient = makeKbClient({
    shastras: async () => [{ natural_key: "samaysaar" }],
    gathaDetail: async ({ number }) => {
      if (number === 1) throw new Error("KB down");
      return { prakrit: `text_${number}` };
    },
  });

  const entries = [
    { name: "direct_retrieval", shastra: "samaysaar", gatha_number: 1, want: ["prakrit"], topic: null },
    { name: "direct_retrieval", shastra: "samaysaar", gatha_number: 2, want: ["prakrit"], topic: null },
  ];

  const results = await runKbSubworkflows(entries, kbClient, "r1");
  assert.equal(results.length, 1, "only successful result returned");
  assert.equal(results[0].gatha_number, 2);
});

test("runKbSubworkflows: all sub-workflows fail — returns []", async () => {
  const kbClient = makeKbClient({
    shastras: async () => { throw new Error("KB down"); },
  });
  const entries = [{ name: "direct_retrieval", shastra: "samaysaar", gatha_number: 6, want: [], topic: null }];
  const results = await runKbSubworkflows(entries, kbClient, "r1");
  assert.deepEqual(results, []);
});

// ─── runKbSubworkflows — parallel execution ───────────────────────────────────

test("runKbSubworkflows: fires all entries in parallel (not sequentially)", async () => {
  const startTimes = [];
  const delay = 100;

  const kbClient = makeKbClient({
    shastras: async () => [{ natural_key: "samaysaar" }],
    gathaDetail: async () => {
      startTimes.push(Date.now());
      await new Promise((resolve) => setTimeout(resolve, delay));
      return { prakrit: "x" };
    },
  });

  const entries = [
    { name: "direct_retrieval", shastra: "samaysaar", gatha_number: 1, want: [], topic: null },
    { name: "direct_retrieval", shastra: "samaysaar", gatha_number: 2, want: [], topic: null },
  ];

  const start = Date.now();
  await runKbSubworkflows(entries, kbClient, "r1");
  const elapsed = Date.now() - start;

  // If sequential, elapsed would be ~200ms; parallel should be ~100ms (with some slack)
  assert.ok(elapsed < delay * 1.8, `expected parallel execution (~${delay}ms), got ${elapsed}ms`);
});

// ─── runKbSubworkflows — unknown sub-workflow name filtered ───────────────────

test("runKbSubworkflows: unknown sub-workflow name is skipped", async () => {
  const kbClient = makeKbClient();
  const entries = [{ name: "unknown_workflow", shastra: "samaysaar", gatha_number: 6, want: [], topic: null }];
  const results = await runKbSubworkflows(entries, kbClient, "r1");
  assert.deepEqual(results, []);
});
