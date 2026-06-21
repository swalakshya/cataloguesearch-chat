import { test } from "node:test";
import assert from "node:assert/strict";

import { runKbKeywordCheck } from "../../src/orchestrator/kb_keyword_check.js";

// Minimal provider stub
const provider = {};
const question = "आत्मा का स्वरूप क्या है?";
const requestId = "r-test";

function makeKbClient(resolutions) {
  return {
    keywordResolveBatch: async () => resolutions,
  };
}

function makeKeywordFixFn(returnValue) {
  let callCount = 0;
  let lastArgs = null;
  const fn = async (args) => {
    callCount++;
    lastArgs = args;
    return returnValue;
  };
  fn.getCallCount = () => callCount;
  fn.getLastArgs = () => lastArgs;
  return fn;
}

// ─── matched-only path ────────────────────────────────────────────────────────

test("runKbKeywordCheck: matched-only — no Step1b, canonical rewrite applied", async () => {
  const step1 = {
    language: "hi",
    workflow: "basic_question_v1",
    keywords: ["आतम", "स्वरूप"],
    jain_keywords: ["आतम"],
    normal_keywords: ["स्वरूप"],
    filters: {},
  };

  const resolutions = [
    { input_token: "आतम", match_kind: "suffix_strip", keyword_natural_key: "आत्मा", suggestions: [] },
  ];

  const fixFn = makeKeywordFixFn({});
  const result = await runKbKeywordCheck({
    step1Result: step1,
    kbApiClient: makeKbClient(resolutions),
    provider,
    question,
    requestId,
    runKeywordFixFn: fixFn,
  });

  assert.equal(fixFn.getCallCount(), 0, "Step1b must NOT fire when all keywords matched");
  assert.deepEqual(result.keywords, ["आत्मा", "स्वरूप"], "matched token rewritten in keywords[]");
  assert.deepEqual(result.jain_keywords, ["आत्मा"], "matched token rewritten in jain_keywords[]");
  assert.deepEqual(result.kb_canonical_map, { "आतम": "आत्मा" });
});

test("runKbKeywordCheck: exact match with same natural key — no rewrite entry", async () => {
  const step1 = {
    language: "hi",
    workflow: "basic_question_v1",
    keywords: ["आत्मा"],
    jain_keywords: ["आत्मा"],
    normal_keywords: [],
    filters: {},
  };

  const resolutions = [
    { input_token: "आत्मा", match_kind: "exact", keyword_natural_key: "आत्मा", suggestions: [] },
  ];

  const result = await runKbKeywordCheck({
    step1Result: step1,
    kbApiClient: makeKbClient(resolutions),
    provider,
    question,
    requestId,
    runKeywordFixFn: makeKeywordFixFn({}),
  });

  assert.deepEqual(result.kb_canonical_map, {}, "no rewrite when token already canonical");
  assert.deepEqual(result.keywords, ["आत्मा"]);
});

// ─── miss with suggestions → Step1b ──────────────────────────────────────────

test("runKbKeywordCheck: miss with suggestions — fires Step1b", async () => {
  const step1 = {
    language: "hi",
    workflow: "basic_question_v1",
    keywords: ["आतम", "ksudra"],
    jain_keywords: ["आतम", "ksudra"],
    normal_keywords: [],
    filters: {},
  };

  const resolutions = [
    { input_token: "आतम", match_kind: "exact", keyword_natural_key: "आत्मा", suggestions: [] },
    {
      input_token: "ksudra",
      match_kind: "none",
      keyword_natural_key: null,
      suggestions: [
        { kw: "क्षुद्र", similarity: 0.58 },
        { kw: "क्षुधा", similarity: 0.41 },
      ],
    },
  ];

  const fixedResult = {
    language: "hi",
    workflow: "basic_question_v1",
    keywords: ["आत्मा", "क्षुद्र"],
    jain_keywords: ["आत्मा", "क्षुद्र"],
    normal_keywords: [],
    filters: {},
  };

  const fixFn = makeKeywordFixFn(fixedResult);
  const result = await runKbKeywordCheck({
    step1Result: step1,
    kbApiClient: makeKbClient(resolutions),
    provider,
    question,
    requestId,
    runKeywordFixFn: fixFn,
  });

  assert.equal(fixFn.getCallCount(), 1, "Step1b must fire");
  const fixArgs = fixFn.getLastArgs();
  assert.equal(fixArgs.missedWithSuggestions.length, 1);
  assert.equal(fixArgs.missedWithSuggestions[0].token, "ksudra");
  assert.equal(fixArgs.missedWithSuggestions[0].suggestions[0].kw, "क्षुद्र");

  // Step1b result merged with canonical map from the matched token
  assert.deepEqual(result.keywords, ["आत्मा", "क्षुद्र"]);
  assert.deepEqual(result.kb_canonical_map, { "आतम": "आत्मा" });
});

// ─── miss without suggestions → no Step1b ────────────────────────────────────

test("runKbKeywordCheck: miss without suggestions — does NOT fire Step1b", async () => {
  const step1 = {
    language: "hi",
    workflow: "basic_question_v1",
    keywords: ["unknownterm"],
    jain_keywords: ["unknownterm"],
    normal_keywords: [],
    filters: {},
  };

  const resolutions = [
    { input_token: "unknownterm", match_kind: "none", keyword_natural_key: null, suggestions: [] },
  ];

  const fixFn = makeKeywordFixFn({});
  const result = await runKbKeywordCheck({
    step1Result: step1,
    kbApiClient: makeKbClient(resolutions),
    provider,
    question,
    requestId,
    runKeywordFixFn: fixFn,
  });

  assert.equal(fixFn.getCallCount(), 0, "Step1b must NOT fire when miss has no suggestions");
  assert.deepEqual(result.kb_canonical_map, {});
});

// ─── no jain_keywords → skip entirely ────────────────────────────────────────

test("runKbKeywordCheck: no jain_keywords — skips KB call entirely", async () => {
  const step1 = {
    language: "hi",
    workflow: "greeting_message_v1",
    keywords: [],
    jain_keywords: [],
    normal_keywords: [],
    filters: {},
  };

  let kbCallCount = 0;
  const kbClient = {
    keywordResolveBatch: async () => {
      kbCallCount++;
      return [];
    },
  };

  const result = await runKbKeywordCheck({
    step1Result: step1,
    kbApiClient: kbClient,
    provider,
    question,
    requestId,
    runKeywordFixFn: makeKeywordFixFn({}),
  });

  assert.equal(kbCallCount, 0, "KB API must not be called when jain_keywords is empty");
  assert.equal(result, step1, "original step1Result returned unchanged");
});

// ─── KB API failure → graceful degradation ───────────────────────────────────

test("runKbKeywordCheck: KB API failure — degrades gracefully, returns original step1", async () => {
  const step1 = {
    language: "hi",
    workflow: "basic_question_v1",
    keywords: ["आत्मा"],
    jain_keywords: ["आत्मा"],
    normal_keywords: [],
    filters: {},
  };

  const failingKbClient = {
    keywordResolveBatch: async () => {
      throw new Error("KB API unreachable");
    },
  };

  const fixFn = makeKeywordFixFn({});
  const result = await runKbKeywordCheck({
    step1Result: step1,
    kbApiClient: failingKbClient,
    provider,
    question,
    requestId,
    runKeywordFixFn: fixFn,
  });

  assert.equal(fixFn.getCallCount(), 0);
  assert.equal(result, step1, "original step1Result returned on KB failure");
});

// ─── canonical rewrite correctness ───────────────────────────────────────────

test("runKbKeywordCheck: canonical rewrite rewrites only matched tokens, leaves rest unchanged", async () => {
  const step1 = {
    language: "hi",
    workflow: "basic_question_v1",
    keywords: ["समयसार", "आतम", "definition"],
    jain_keywords: ["समयसार", "आतम"],
    normal_keywords: ["definition"],
    filters: {},
  };

  const resolutions = [
    { input_token: "समयसार", match_kind: "alias", keyword_natural_key: "Samaysar", suggestions: [] },
    { input_token: "आतम", match_kind: "suffix_strip", keyword_natural_key: "आत्मा", suggestions: [] },
  ];

  const result = await runKbKeywordCheck({
    step1Result: step1,
    kbApiClient: makeKbClient(resolutions),
    provider,
    question,
    requestId,
    runKeywordFixFn: makeKeywordFixFn({}),
  });

  assert.deepEqual(result.keywords, ["Samaysar", "आत्मा", "definition"]);
  assert.deepEqual(result.jain_keywords, ["Samaysar", "आत्मा"]);
  assert.deepEqual(result.normal_keywords, ["definition"], "normal_keywords unaffected");
  assert.deepEqual(result.kb_canonical_map, { "समयसार": "Samaysar", "आतम": "आत्मा" });
});

// ─── kb_canonical_map preserved through Step1b ───────────────────────────────

test("runKbKeywordCheck: kb_canonical_map is preserved on the Step1b result", async () => {
  const step1 = {
    language: "hi",
    workflow: "basic_question_v1",
    keywords: ["आतम", "ksudra"],
    jain_keywords: ["आतम", "ksudra"],
    normal_keywords: [],
    filters: {},
  };

  const resolutions = [
    { input_token: "आतम", match_kind: "exact", keyword_natural_key: "आत्मा", suggestions: [] },
    { input_token: "ksudra", match_kind: "none", keyword_natural_key: null, suggestions: [{ kw: "क्षुद्र", similarity: 0.58 }] },
  ];

  const fixedResult = { language: "hi", workflow: "basic_question_v1", keywords: ["आत्मा", "क्षुद्र"], jain_keywords: ["आत्मा", "क्षुद्र"], normal_keywords: [], filters: {} };
  const result = await runKbKeywordCheck({
    step1Result: step1,
    kbApiClient: makeKbClient(resolutions),
    provider,
    question,
    requestId,
    runKeywordFixFn: makeKeywordFixFn(fixedResult),
  });

  assert.ok(result.kb_canonical_map, "kb_canonical_map must be present");
  assert.deepEqual(result.kb_canonical_map, { "आतम": "आत्मा" });
});

// ─── integration-style: three scenarios through pipeline ─────────────────────

test("integration: scenario A — all matched, canonical rewrites propagate, Step1b skipped", async () => {
  const step1 = {
    language: "hi", workflow: "basic_question_v1",
    keywords: ["कर्म", "आतमा"], jain_keywords: ["कर्म", "आतमा"], normal_keywords: [], filters: {},
  };
  const resolutions = [
    { input_token: "कर्म", match_kind: "exact", keyword_natural_key: "कर्म", suggestions: [] },
    { input_token: "आतमा", match_kind: "alias", keyword_natural_key: "आत्मा", suggestions: [] },
  ];
  const fixFn = makeKeywordFixFn({});
  const result = await runKbKeywordCheck({ step1Result: step1, kbApiClient: makeKbClient(resolutions), provider, question, requestId, runKeywordFixFn: fixFn });
  assert.equal(fixFn.getCallCount(), 0);
  assert.deepEqual(result.keywords, ["कर्म", "आत्मा"]);
  assert.deepEqual(result.kb_canonical_map, { "आतमा": "आत्मा" });
});

test("integration: scenario B — one miss with suggestion, Step1b fires, result merged correctly", async () => {
  const step1 = {
    language: "hi", workflow: "basic_question_v1",
    keywords: ["आत्मा", "moksha"], jain_keywords: ["आत्मा", "moksha"], normal_keywords: [], filters: {},
  };
  const resolutions = [
    { input_token: "आत्मा", match_kind: "exact", keyword_natural_key: "आत्मा", suggestions: [] },
    { input_token: "moksha", match_kind: "none", keyword_natural_key: null, suggestions: [{ kw: "मोक्ष", similarity: 0.72 }] },
  ];
  const fixedResult = { language: "hi", workflow: "basic_question_v1", keywords: ["आत्मा", "मोक्ष"], jain_keywords: ["आत्मा", "मोक्ष"], normal_keywords: [], filters: {} };
  const fixFn = makeKeywordFixFn(fixedResult);
  const result = await runKbKeywordCheck({ step1Result: step1, kbApiClient: makeKbClient(resolutions), provider, question, requestId, runKeywordFixFn: fixFn });
  assert.equal(fixFn.getCallCount(), 1);
  assert.deepEqual(result.keywords, ["आत्मा", "मोक्ष"]);
  assert.deepEqual(result.kb_canonical_map, {});
});

test("integration: scenario C — all misses with no suggestions, nothing fires", async () => {
  const step1 = {
    language: "hi", workflow: "basic_question_v1",
    keywords: ["xyz123", "abc456"], jain_keywords: ["xyz123", "abc456"], normal_keywords: [], filters: {},
  };
  const resolutions = [
    { input_token: "xyz123", match_kind: "none", keyword_natural_key: null, suggestions: [] },
    { input_token: "abc456", match_kind: "none", keyword_natural_key: null, suggestions: [] },
  ];
  const fixFn = makeKeywordFixFn({});
  const result = await runKbKeywordCheck({ step1Result: step1, kbApiClient: makeKbClient(resolutions), provider, question, requestId, runKeywordFixFn: fixFn });
  assert.equal(fixFn.getCallCount(), 0);
  assert.deepEqual(result.kb_canonical_map, {});
});
