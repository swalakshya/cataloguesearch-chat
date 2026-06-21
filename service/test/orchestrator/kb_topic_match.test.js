import { test } from "node:test";
import assert from "node:assert/strict";

import {
  attachNeighbors,
  extractKeywordSets,
  formatKbTopicsContext,
  runKbTopicMatch,
} from "../../src/orchestrator/kb_topic_match.js";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeTopic(overrides = {}) {
  return {
    topic_natural_key: "आत्मा",
    topic_pg_id: "1",
    display_text_hi: "आत्मा",
    ancestors_hi: ["दर्शन"],
    score: 0.8,
    is_leaf: true,
    source: "topics_match",
    extracts_hi: [{
      block_index: 0,
      text_hi: "आत्मा का स्वरूप...",
      main_reference: {
        shastra_name: "समयसार",
        teeka_name: null,
        resolved_fields: [{ field: "गाथा", value: 1 }],
      },
    }],
    ...overrides,
  };
}

function makeNeighbors(overrides = {}) {
  return {
    related_topics: [{ topic_natural_key: "मोक्ष", display_text_hi: "मोक्ष" }],
    related_keywords: [],
    mentioned_in_gathas: [],
    ...overrides,
  };
}

// ─── attachNeighbors ──────────────────────────────────────────────────────────

test("attachNeighbors: anchor with matching neighbors gets them attached", () => {
  const anchors = [makeTopic({ topic_natural_key: "आत्मा" })];
  const neighborsByAnchor = { "आत्मा": makeNeighbors() };

  const result = attachNeighbors(anchors, neighborsByAnchor);
  assert.deepEqual(result[0].neighbors, makeNeighbors());
});

test("attachNeighbors: anchor without matching neighbors has no neighbors field added", () => {
  const anchors = [makeTopic({ topic_natural_key: "कर्म" })];
  const neighborsByAnchor = { "आत्मा": makeNeighbors() };

  const result = attachNeighbors(anchors, neighborsByAnchor);
  assert.ok(!("neighbors" in result[0]), "no neighbors field when no match");
});

test("attachNeighbors: unknown-anchor row in neighborsByAnchor is ignored", () => {
  const anchors = [makeTopic({ topic_natural_key: "आत्मा" })];
  const neighborsByAnchor = {
    "आत्मा": makeNeighbors(),
    "unknown_key": makeNeighbors({ related_topics: [{ topic_natural_key: "x", display_text_hi: "X" }] }),
  };

  const result = attachNeighbors(anchors, neighborsByAnchor);
  assert.equal(result.length, 1, "only anchors returned, no extras");
  assert.deepEqual(result[0].neighbors, makeNeighbors());
});

test("attachNeighbors: empty anchors returns empty array", () => {
  assert.deepEqual(attachNeighbors([], { "आत्मा": makeNeighbors() }), []);
});

test("attachNeighbors: empty neighborsByAnchor — anchors unchanged", () => {
  const anchors = [makeTopic()];
  const result = attachNeighbors(anchors, {});
  assert.ok(!("neighbors" in result[0]));
});

test("attachNeighbors: null/array neighborsByAnchor treated as empty map", () => {
  const anchors = [makeTopic({ topic_natural_key: "आत्मा" })];
  assert.ok(!("neighbors" in attachNeighbors(anchors, null)[0]));
  assert.ok(!("neighbors" in attachNeighbors(anchors, [])[0]));
});

// ─── extractKeywordSets ───────────────────────────────────────────────────────

test("extractKeywordSets: basic_question_v1 returns single set", () => {
  const kr = { workflow: "basic_question_v1", keywords: ["आत्मा", "स्वरूप"] };
  const sets = extractKeywordSets(kr);
  assert.equal(sets.length, 1);
  assert.deepEqual(sets[0], ["आत्मा", "स्वरूप"]);
});

test("extractKeywordSets: basic_question_v1 with empty keywords returns []", () => {
  const sets = extractKeywordSets({ workflow: "basic_question_v1", keywords: [] });
  assert.deepEqual(sets, []);
});

test("extractKeywordSets: followup_question_v1 returns root + each followup set", () => {
  const kr = {
    workflow: "followup_question_v1",
    keywords: ["आत्मा"],
    followup_keywords: [
      { id: "set_1", keywords: ["कर्म"] },
      { id: "set_2", keywords: ["मोक्ष"] },
    ],
  };
  const sets = extractKeywordSets(kr);
  assert.equal(sets.length, 3);
  assert.deepEqual(sets[0], ["आत्मा"]);
  assert.deepEqual(sets[1], ["कर्म"]);
  assert.deepEqual(sets[2], ["मोक्ष"]);
});

test("extractKeywordSets: advanced_distinct_questions_v1 returns one set per query", () => {
  const kr = {
    workflow: "advanced_distinct_questions_v1",
    keywords: ["ignored"],
    queries: [
      { id: "q1", keywords: ["आत्मा"] },
      { id: "q2", keywords: ["कर्म"] },
    ],
  };
  const sets = extractKeywordSets(kr);
  assert.equal(sets.length, 2);
  assert.deepEqual(sets[0], ["आत्मा"]);
  assert.deepEqual(sets[1], ["कर्म"]);
});

test("extractKeywordSets: advanced_nested_questions_v1 returns main + sub sets", () => {
  const kr = {
    workflow: "advanced_nested_questions_v1",
    main_query: { keywords: ["समयसार"] },
    sub_queries: [
      { id: "sq1", keywords: ["गाथा"] },
      { id: "sq2", keywords: ["आत्मा"] },
    ],
  };
  const sets = extractKeywordSets(kr);
  assert.equal(sets.length, 3);
  assert.deepEqual(sets[0], ["समयसार"]);
  assert.deepEqual(sets[1], ["गाथा"]);
  assert.deepEqual(sets[2], ["आत्मा"]);
});

test("extractKeywordSets: metadata_question_v1 returns []", () => {
  const sets = extractKeywordSets({ workflow: "metadata_question_v1", keywords: ["x"] });
  assert.deepEqual(sets, []);
});

test("extractKeywordSets: greeting_message_v1 returns []", () => {
  const sets = extractKeywordSets({ workflow: "greeting_message_v1", keywords: ["x"] });
  assert.deepEqual(sets, []);
});

test("extractKeywordSets: followup with null followup_keywords — only root returned", () => {
  const kr = { workflow: "followup_question_v1", keywords: ["आत्मा"], followup_keywords: null };
  const sets = extractKeywordSets(kr);
  assert.equal(sets.length, 1);
  assert.deepEqual(sets[0], ["आत्मा"]);
});

// ─── formatKbTopicsContext ────────────────────────────────────────────────────

test("formatKbTopicsContext: empty array returns empty text and citations", () => {
  assert.deepEqual(formatKbTopicsContext([]), { text: "", citations: [] });
  assert.deepEqual(formatKbTopicsContext(null), { text: "", citations: [] });
});

test("formatKbTopicsContext: source_url tags a citable id and yields a citation", () => {
  const topics = [
    makeTopic({
      topic_natural_key: "द्रव्य/स्वतंत्रता/लक्षण",
      display_text_hi: "लक्षण",
      source_url: "https://www.jainkosh.org/wiki/द्रव्य#3.1",
    }),
  ];
  const { text, citations } = formatKbTopicsContext(topics);
  assert.ok(text.includes("[KB-T-1] topic: लक्षण"), "id tag embedded in topic line");
  assert.deepEqual(citations, [
    { id: "KB-T-1", label: "लक्षण", source_url: "https://www.jainkosh.org/wiki/द्रव्य#3.1" },
  ]);
});

test("formatKbTopicsContext: topic without source_url gets no id tag and no citation", () => {
  const { text, citations } = formatKbTopicsContext([makeTopic({ display_text_hi: "कर्म" })]);
  assert.ok(!text.includes("[KB-T-"), "no id tag when no source_url");
  assert.deepEqual(citations, []);
});

test("formatKbTopicsContext: single topic — correct header and fields", () => {
  const topics = [
    makeTopic({
      display_text_hi: "आत्मा",
      ancestors_hi: ["दर्शन", "जीव"],
      extracts_hi: [{
        block_index: 0,
        text_hi: "आत्मा का स्वरूप है।",
        main_reference: {
          shastra_name: "समयसार",
          teeka_name: null,
          resolved_fields: [{ field: "गाथा", value: 6 }],
        },
      }],
    }),
  ];
  const out = formatKbTopicsContext(topics).text;
  assert.ok(out.startsWith("### KB Topics (Hindi extracts, closest first)"), "header present");
  assert.ok(out.includes("topic: आत्मा"), "topic line present");
  assert.ok(!out.includes("path:"), "path line must be removed");
  assert.ok(out.includes("extract: आत्मा का स्वरूप है।"), "extract line present");
  assert.ok(out.includes("ref: shastra=समयसार, गाथा=6"), "per-extract main ref present");
});

test("formatKbTopicsContext: all extracts rendered, each with its own ref", () => {
  const topics = [makeTopic({
    extracts_hi: [
      {
        block_index: 0,
        text_hi: "पहला अंश।",
        main_reference: { shastra_name: "मोक्ष पाहुड़", teeka_name: null, resolved_fields: [{ field: "गाथा", value: 8 }] },
      },
      {
        block_index: 1,
        text_hi: "दूसरा अंश।",
        main_reference: { shastra_name: "समाधिशतक", teeka_name: null, resolved_fields: [{ field: "गाथा", value: 4 }] },
      },
    ],
  })];
  const out = formatKbTopicsContext(topics).text;
  assert.ok(out.includes("extract: पहला अंश।"), "first extract present");
  assert.ok(out.includes("ref: shastra=मोक्ष पाहुड़, गाथा=8"), "first extract ref");
  assert.ok(out.includes("extract: दूसरा अंश।"), "second extract present");
  assert.ok(out.includes("ref: shastra=समाधिशतक, गाथा=4"), "second extract ref");
});

test("formatKbTopicsContext: excluded fields dropped and shastra prefix stripped", () => {
  const topics = [makeTopic({
    extracts_hi: [{
      block_index: 0,
      text_hi: "धवला अंश।",
      main_reference: {
        shastra_name: "धवला",
        teeka_name: null,
        resolved_fields: [
          { field: "पुस्तक", value: 13 },
          { field: "धवलासूत्र", value: 50 },
          { field: "पृष्ठ", value: 282 },
          { field: "पंक्ति", value: 11 },
        ],
      },
    }],
  })];
  const out = formatKbTopicsContext(topics).text;
  assert.ok(out.includes("ref: shastra=धवला, सूत्र=50"), "prefix stripped, locator fields dropped");
  assert.ok(!out.includes("पुस्तक"), "पुस्तक excluded");
  assert.ok(!out.includes("पृष्ठ"), "पृष्ठ excluded");
  assert.ok(!out.includes("पंक्ति"), "पंक्ति excluded");
});

test("formatKbTopicsContext: teeka name included in ref", () => {
  const topics = [makeTopic({
    extracts_hi: [{
      block_index: 0,
      text_hi: "टीका अंश।",
      main_reference: {
        shastra_name: "द्रव्यसंग्रह",
        teeka_name: "टीका",
        resolved_fields: [{ field: "गाथा", value: 57 }],
      },
    }],
  })];
  const out = formatKbTopicsContext(topics).text;
  assert.ok(out.includes("ref: shastra=द्रव्यसंग्रह, teeka=टीका, गाथा=57"), "teeka present in ref");
});

test("formatKbTopicsContext: topic with no extracts — no extract line", () => {
  const topics = [makeTopic({ extracts_hi: null })];
  const out = formatKbTopicsContext(topics).text;
  assert.ok(!out.includes("extract:"), "extract line must be absent when no extracts");
});

test("formatKbTopicsContext: extract with no main_reference — no ref line", () => {
  const topics = [makeTopic({ extracts_hi: [{ block_index: 0, text_hi: "बिना संदर्भ।", main_reference: null }] })];
  const out = formatKbTopicsContext(topics).text;
  assert.ok(out.includes("extract: बिना संदर्भ।"), "extract present");
  assert.ok(!out.includes("ref:"), "ref line absent when no main_reference");
});

test("formatKbTopicsContext: topic with neighbors — related line rendered", () => {
  const topics = [makeTopic({
    neighbors: {
      related_topics: [
        { topic_natural_key: "मोक्ष", display_text_hi: "मोक्ष" },
        { topic_natural_key: "कर्म", display_text_hi: "कर्म" },
      ],
      related_keywords: [],
      mentioned_in_gathas: [],
    },
  })];
  const out = formatKbTopicsContext(topics).text;
  assert.ok(out.includes("related: मोक्ष, कर्म"), "related line with comma-joined topics");
});

test("formatKbTopicsContext: topic with empty related_topics — no related line", () => {
  const topics = [makeTopic({ neighbors: { related_topics: [], related_keywords: [], mentioned_in_gathas: [] } })];
  const out = formatKbTopicsContext(topics).text;
  assert.ok(!out.includes("related:"), "no related line when related_topics is empty");
});

test("formatKbTopicsContext: topic with no neighbors — no related line", () => {
  const topics = [makeTopic()];
  const out = formatKbTopicsContext(topics).text;
  assert.ok(!out.includes("related:"), "no related line when neighbors absent");
});

test("formatKbTopicsContext: multiple topics — all rendered in order", () => {
  const topics = [
    makeTopic({ topic_natural_key: "t1", display_text_hi: "आत्मा" }),
    makeTopic({ topic_natural_key: "t2", display_text_hi: "कर्म" }),
  ];
  const out = formatKbTopicsContext(topics).text;
  const idx1 = out.indexOf("आत्मा");
  const idx2 = out.indexOf("कर्म");
  assert.ok(idx1 < idx2, "topics rendered in input order");
});

// ─── runKbTopicMatch — sequential anchor→expand, no graphrag ─────────────────

function makeKbClient({
  topicsMatchResult = [],
  topicNeighborsResult = {},
  topicsMatchFails = false,
  topicNeighborsFails = false,
} = {}) {
  return {
    topicsMatch: async () => {
      if (topicsMatchFails) throw new Error("topics_match unreachable");
      return topicsMatchResult;
    },
    topicNeighbors: async () => {
      if (topicNeighborsFails) throw new Error("topic_neighbors unreachable");
      return topicNeighborsResult;
    },
  };
}

test("runKbTopicMatch: basic_question — fires 1 topicsMatch + 1 topicNeighbors, no graphrag", async () => {
  let topicsMatchCalls = 0;
  let topicNeighborsCalls = 0;
  const kbClient = {
    topicsMatch: async () => { topicsMatchCalls++; return [makeTopic()]; },
    topicNeighbors: async () => { topicNeighborsCalls++; return {}; },
  };

  await runKbTopicMatch({
    keywordResult: { workflow: "basic_question_v1", keywords: ["आत्मा"] },
    kbApiClient: kbClient,
    requestId: "r1",
  });

  assert.equal(topicsMatchCalls, 1);
  assert.equal(topicNeighborsCalls, 1);
  assert.ok(!("graphrag" in kbClient), "no graphrag on client needed");
});

test("runKbTopicMatch: topicNeighbors receives exact anchor natural_keys", async () => {
  let receivedKeys = null;
  const kbClient = {
    topicsMatch: async () => [
      makeTopic({ topic_natural_key: "आत्मा" }),
      makeTopic({ topic_natural_key: "कर्म", display_text_hi: "कर्म" }),
    ],
    topicNeighbors: async ({ topicNaturalKeys }) => { receivedKeys = topicNaturalKeys; return {}; },
  };

  await runKbTopicMatch({
    keywordResult: { workflow: "basic_question_v1", keywords: ["आत्मा"] },
    kbApiClient: kbClient,
    requestId: "r-keys",
  });

  assert.deepEqual(receivedKeys, ["आत्मा", "कर्म"]);
});

test("runKbTopicMatch: followup with 2 followup sets — 3 topicsMatch + 3 topicNeighbors calls, 0 graphrag", async () => {
  let topicsMatchCalls = 0;
  let topicNeighborsCalls = 0;
  const kbClient = {
    topicsMatch: async () => { topicsMatchCalls++; return [makeTopic()]; },
    topicNeighbors: async () => { topicNeighborsCalls++; return {}; },
  };

  await runKbTopicMatch({
    keywordResult: {
      workflow: "followup_question_v1",
      keywords: ["आत्मा"],
      followup_keywords: [
        { id: "s1", keywords: ["कर्म"] },
        { id: "s2", keywords: ["मोक्ष"] },
      ],
    },
    kbApiClient: kbClient,
    requestId: "r2",
  });

  assert.equal(topicsMatchCalls, 3, "3 keyword sets × 1 topicsMatch each");
  assert.equal(topicNeighborsCalls, 3, "3 keyword sets × 1 topicNeighbors each");
});

test("runKbTopicMatch: topicNeighbors NOT called when topicsMatch returns empty anchors", async () => {
  let topicNeighborsCalls = 0;
  const kbClient = {
    topicsMatch: async () => [],
    topicNeighbors: async () => { topicNeighborsCalls++; return {}; },
  };

  await runKbTopicMatch({
    keywordResult: { workflow: "basic_question_v1", keywords: ["आत्मा"] },
    kbApiClient: kbClient,
    requestId: "r-skip-expand",
  });

  assert.equal(topicNeighborsCalls, 0, "expand skipped when anchor stage returns nothing");
});

test("runKbTopicMatch: metadata_question — no kb calls fired", async () => {
  let callCount = 0;
  const kbClient = {
    topicsMatch: async () => { callCount++; return []; },
    topicNeighbors: async () => { callCount++; return {}; },
  };

  const result = await runKbTopicMatch({
    keywordResult: { workflow: "metadata_question_v1", keywords: ["x"] },
    kbApiClient: kbClient,
    requestId: "r3",
  });

  assert.equal(callCount, 0, "no KB calls for metadata workflow");
  assert.deepEqual(result, []);
});

test("runKbTopicMatch: stage-1 fails — returns [] (no expand attempted)", async () => {
  let topicNeighborsCalls = 0;
  const kbClient = makeKbClient({ topicsMatchFails: true });
  kbClient.topicNeighbors = async () => { topicNeighborsCalls++; return {}; };

  const result = await runKbTopicMatch({
    keywordResult: { workflow: "basic_question_v1", keywords: ["आत्मा"] },
    kbApiClient: kbClient,
    requestId: "r4",
  });

  assert.deepEqual(result, [], "empty on stage-1 failure");
  assert.equal(topicNeighborsCalls, 0, "expand not attempted when anchor fails");
});

test("runKbTopicMatch: stage-2 fails — returns anchors without neighbors", async () => {
  const kbClient = makeKbClient({ topicsMatchResult: [makeTopic()], topicNeighborsFails: true });

  const result = await runKbTopicMatch({
    keywordResult: { workflow: "basic_question_v1", keywords: ["आत्मा"] },
    kbApiClient: kbClient,
    requestId: "r5",
  });

  assert.equal(result.length, 1, "anchors returned even when expand fails");
  assert.ok(!("neighbors" in result[0]), "no neighbors when expand failed");
});

test("runKbTopicMatch: neighbors attached from stage-2 response", async () => {
  const nb = makeNeighbors();
  const kbClient = makeKbClient({
    topicsMatchResult: [makeTopic({ topic_natural_key: "आत्मा" })],
    topicNeighborsResult: { "आत्मा": nb },
  });

  const result = await runKbTopicMatch({
    keywordResult: { workflow: "basic_question_v1", keywords: ["आत्मा"] },
    kbApiClient: kbClient,
    requestId: "r-nb",
  });

  assert.equal(result.length, 1);
  assert.deepEqual(result[0].neighbors, nb);
});

test("runKbTopicMatch: results from multiple keyword sets are merged and sorted by score", async () => {
  const kbClient = {
    topicsMatch: async ({ keywords }) => keywords[0] === "आत्मा"
      ? [makeTopic({ topic_natural_key: "आत्मा", score: 0.9 })]
      : [makeTopic({ topic_natural_key: "कर्म", score: 0.7, display_text_hi: "कर्म" })],
    topicNeighbors: async () => ({}),
  };

  const result = await runKbTopicMatch({
    keywordResult: {
      workflow: "followup_question_v1",
      keywords: ["आत्मा"],
      followup_keywords: [{ id: "s1", keywords: ["कर्म"] }],
    },
    kbApiClient: kbClient,
    requestId: "r7",
  });

  const keys = result.map((t) => t.topic_natural_key);
  assert.ok(keys.includes("आत्मा"), "आत्मा from root set");
  assert.ok(keys.includes("कर्म"), "कर्म from followup set");
  assert.equal(result[0].topic_natural_key, "आत्मा", "sorted by score DESC");
});

test("runKbTopicMatch: duplicate topic across sets — highest score wins", async () => {
  const kbClient = {
    topicsMatch: async ({ keywords }) => keywords[0] === "आत्मा"
      ? [makeTopic({ topic_natural_key: "आत्मा", score: 0.9 })]
      : [makeTopic({ topic_natural_key: "आत्मा", score: 0.5 })],
    topicNeighbors: async () => ({}),
  };

  const result = await runKbTopicMatch({
    keywordResult: {
      workflow: "followup_question_v1",
      keywords: ["आत्मा"],
      followup_keywords: [{ id: "s1", keywords: ["related"] }],
    },
    kbApiClient: kbClient,
    requestId: "r-dedup",
  });

  assert.equal(result.length, 1, "deduplicated to single entry");
  assert.equal(result[0].score, 0.9, "highest score retained");
});

test("runKbTopicMatch: merge cap applied — only top KB_TOPIC_MERGE_LIMIT returned", async () => {
  const originalLimit = process.env.KB_TOPIC_MERGE_LIMIT;
  process.env.KB_TOPIC_MERGE_LIMIT = "2";
  try {
    const kbClient = {
      topicsMatch: async () => [
        makeTopic({ topic_natural_key: "t1", score: 0.9 }),
        makeTopic({ topic_natural_key: "t2", score: 0.7, display_text_hi: "t2" }),
        makeTopic({ topic_natural_key: "t3", score: 0.5, display_text_hi: "t3" }),
      ],
      topicNeighbors: async () => ({}),
    };

    const result = await runKbTopicMatch({
      keywordResult: { workflow: "basic_question_v1", keywords: ["आत्मा"] },
      kbApiClient: kbClient,
      requestId: "r-cap",
    });

    assert.equal(result.length, 2, "capped at KB_TOPIC_MERGE_LIMIT");
    assert.equal(result[0].topic_natural_key, "t1");
    assert.equal(result[1].topic_natural_key, "t2");
  } finally {
    if (originalLimit === undefined) delete process.env.KB_TOPIC_MERGE_LIMIT;
    else process.env.KB_TOPIC_MERGE_LIMIT = originalLimit;
  }
});

test("runKbTopicMatch: empty keywords array — no calls, returns []", async () => {
  let callCount = 0;
  const kbClient = {
    topicsMatch: async () => { callCount++; return []; },
    topicNeighbors: async () => { callCount++; return {}; },
  };

  const result = await runKbTopicMatch({
    keywordResult: { workflow: "basic_question_v1", keywords: [] },
    kbApiClient: kbClient,
    requestId: "r8",
  });

  assert.equal(callCount, 0);
  assert.deepEqual(result, []);
});
