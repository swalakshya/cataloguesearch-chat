/**
 * Phase 9 — KB Enhancement Integration Tests
 *
 * Five scenarios that verify end-to-end behaviour when KB service is enabled
 * or disabled. Each scenario spins up a real chat server (test-mode) alongside
 * an in-process kb-service mock.
 *
 * Requires TEST_MODE=true (set by the docker-compose integration test runner).
 */

import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import { rm } from "node:fs/promises";

import { createServer } from "../../src/server.js";
import { createKbMock } from "../../test_support/kb_mock.js";
import { isIntegrationEnabled, post, get } from "../../test_support/integration_harness.js";

const INTEGRATION_ENABLED = isIntegrationEnabled();
const integrationTest = INTEGRATION_ENABLED ? test : test.skip;

// ─── Shared kb mock fixture ────────────────────────────────────────────────────

const kbTopicsMatchResponse = {
  matches: [
    {
      topic_natural_key: "आत्मा/स्वरूप",
      display_text_hi: "आत्मा का स्वरूप",
      score: 0.9,
      ancestors_hi: ["आत्मा"],
      source_url: "https://www.jainkosh.org/wiki/आत्मा#3.1",
      extracts_hi: [{
        block_index: 1,
        text_hi: "आत्मा नित्य है।",
        main_reference: {
          shastra_name: "समयसार",
          teeka_name: null,
          resolved_fields: [{ field: "गाथा", value: 1 }],
        },
      }],
      references: [{ shastra_natural_key: "samaysaar", gatha_number: 1 }],
    },
  ],
  tool_trace_id: "mock-trace-1",
};

const kbGraphragResponse = {
  ranked_topics: [],
  unresolved_tokens: [],
  tool_trace_id: "mock-trace-2",
};

// Stage-2 of the topic-match path (03a): topic_neighbors expands each anchor.
// The live query-service returns neighbors_by_anchor as a LIST of objects each
// carrying anchor_topic_natural_key (verified against port 8004). The client
// converts this to a map; the mock mirrors the real list shape.
const kbTopicNeighborsResponse = {
  neighbors_by_anchor: [
    {
      anchor_topic_natural_key: "आत्मा/स्वरूप",
      related_topics: [{ topic_natural_key: "आत्मा/लक्षण", display_text_hi: "आत्मा का लक्षण" }],
      related_keywords: [],
      mentioned_in_gathas: [],
    },
  ],
  unresolved_topic_keys: [],
  tool_trace_id: "mock-trace-neighbors",
};

// Real query-service wraps resolutions in { resolutions: [...], tool_trace_id }.
const kbKeywordResolveResponse = {
  resolutions: [
    {
      input_token: "आत्मा",
      keyword_natural_key: "आत्मा",
      match_kind: "exact",
      suggestions: [],
      source_url: "https://www.jainkosh.org/wiki/आत्मा",
      definitions: [{ text_hi: "आत्मा: जीव का शुद्ध स्वरूप।", source_natural_key: "jainkosh:आत्मा" }],
    },
  ],
  tool_trace_id: "mock-trace-kw",
};

// Topic-neighbors fixture carrying hydrated related_topics + related_keywords
// so the 03b nested context rendering is exercised end-to-end.
const kbTopicNeighborsWithRelated = {
  neighbors_by_anchor: [
    {
      anchor_topic_natural_key: "आत्मा/स्वरूप",
      related_topics: [{
        topic_natural_key: "आत्मा/लक्षण",
        display_text_hi: "आत्मा का लक्षण",
        hops: 1,
        extracts_hi: [{
          block_index: 0,
          text_hi: "आत्मा ज्ञाता-द्रष्टा है।",
          main_reference: {
            shastra_name: "प्रवचनसार",
            teeka_name: null,
            resolved_fields: [{ field: "गाथा", value: 2 }],
          },
        }],
      }],
      related_keywords: [{ keyword_natural_key: "आत्मा", display_text_hi: "आत्मा" }],
      mentioned_in_gathas: [{ shastra_natural_key: "samaysaar", gatha_number: null }],
    },
  ],
  unresolved_topic_keys: [],
  tool_trace_id: "mock-trace-neighbors-2",
};

// Core-service resource envelope shapes (verified against :8001): { items, pagination }
// with the display name in a localized-string array (title[] / display_name[]).
const kbShastrasResponse = {
  items: [
    { natural_key: "समयसार", title: [{ lang: "hin", script: "Deva", text: "समयसार" }], similarity: 1.0 },
  ],
  pagination: { total: 1 },
};
const kbAuthorsResponse = {
  items: [
    { natural_key: "कुन्दकुन्दाचार्य", display_name: [{ lang: "hin", text: "कुन्दकुन्दाचार्य" }], similarity: 0.57 },
  ],
  pagination: { total: 1 },
};

// query-service sub-workflow shapes (verified against :8004).
const kbTopicsInShastraResponse = {
  topics: [
    { topic_natural_key: "आत्मा अकर्ता", display_text_hi: "आत्मा अकर्ता", mention_count: 15 },
  ],
  tool_trace_id: "mock-trace-tis",
};
const kbShastrasForTopicResponse = {
  topic_natural_key: "द्रव्य",
  shastras: [
    { shastra_natural_key: "धवला", name_hi: "", total_mentions: 3, gathas: [{ number: 12, page_number: null }] },
  ],
  tool_trace_id: "mock-trace-sft",
};

/**
 * Spin up a test chat server + kb mock, send one message, run assertions, and
 * always tear down. `opts.behaviors` is an object map endpoint→body. `opts.env`
 * sets process.env for the duration (restored after). `fn` receives
 * { result, kbMock, baseUrl, context, kbStats }.
 */
async function withKbServer({ content, behaviors = {}, env = {}, serverConfig = {} }, fn) {
  const kbMock = createKbMock();
  let server;
  const dbPath = os.tmpdir() + `/kb-test-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}.db`;
  const savedEnv = {};
  for (const [k, v] of Object.entries(env)) { savedEnv[k] = process.env[k]; process.env[k] = v; }
  try {
    const kbBaseUrl = await kbMock.start();
    for (const [ep, body] of Object.entries(behaviors)) kbMock.setBehavior(ep, { body });
    server = createServer({
      testMode: true,
      cleanSessionDb: false,
      chatDbPath: dbPath,
      port: 0,
      host: "127.0.0.1",
      kbEnhanceEnabled: true,
      kbApiBaseUrl: kbBaseUrl,
      kbApiCoreBaseUrl: kbBaseUrl,
      kbApiTimeoutMs: 3000,
      ...serverConfig,
    });
    await server.start({ port: 0, host: "127.0.0.1" });
    const baseUrl = server.getBaseUrl();

    const session = await post(baseUrl, "/v1/chat/sessions", {});
    const result = await post(baseUrl, `/v1/chat/sessions/${session.json.session_id}/messages`, {
      role: "user",
      content,
      response_format: "structured",
    });
    const ctxResp = await get(baseUrl, "/v1/test/last-synthesis-context");
    const kbStats = await get(baseUrl, "/v1/debug/kb-stats");
    await fn({ result, kbMock, baseUrl, context: ctxResp.json.context || "", kbStats: kbStats.json });
  } finally {
    await server?.stop?.();
    await kbMock.stop();
    for (const f of [dbPath, `${dbPath}-wal`, `${dbPath}-shm`]) await rm(f, { force: true });
    for (const [k, v] of Object.entries(savedEnv)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

// ─── Scenario 1: KB enabled — basic question with jain term ──────────────────

integrationTest("scenario 1: KB enabled — topics_match and topic_neighbors are called for a basic jain question", async () => {
  const kbMock = createKbMock();
  let kbBaseUrl;
  let server;
  let baseUrl;
  const dbPath = os.tmpdir() + `/kb-test-s1-${process.pid}-${Date.now()}.db`;

  try {
    kbBaseUrl = await kbMock.start();

    // Configure mock responses
    kbMock.setBehavior("topics_match", { body: kbTopicsMatchResponse });
    kbMock.setBehavior("topic_neighbors", { body: kbTopicNeighborsResponse });
    kbMock.setBehavior("keyword_resolve_batch", { body: kbKeywordResolveResponse });

    server = createServer({
      testMode: true,
      cleanSessionDb: false,
      chatDbPath: dbPath,
      port: 0,
      host: "127.0.0.1",
      kbEnhanceEnabled: true,
      kbApiBaseUrl: kbBaseUrl,
      kbApiCoreBaseUrl: kbBaseUrl,
      kbApiTimeoutMs: 3000,
    });
    await server.start({ port: 0, host: "127.0.0.1" });
    baseUrl = server.getBaseUrl();

    const session = await post(baseUrl, "/v1/chat/sessions", {});
    const result = await post(baseUrl, `/v1/chat/sessions/${session.json.session_id}/messages`, {
      role: "user",
      content: "JAIN_QUESTION आत्मा क्या है?",
      response_format: "structured",
    });

    assert.equal(result.res.status, 200, "request should succeed");
    assert.equal(typeof result.json.answer, "string", "answer should be a string");

    // KB source_url citations: the topic/keyword carry source_url, so the Step2
    // context tags them (KB-T-n / KB-D-n). The test LLM echoes cited KB ids into
    // `scoring`, so their jainkosh URLs must surface in references[].
    assert.ok(Array.isArray(result.json.references), "references should be an array");
    assert.ok(
      result.json.references.some((r) => String(r).includes("https://www.jainkosh.org/wiki/आत्मा#3.1")),
      "topic source_url should be merged into references"
    );
    assert.ok(
      result.json.references.some((r) => String(r).includes("https://www.jainkosh.org/wiki/आत्मा") && !String(r).includes("#")),
      "keyword definition source_url should be merged into references"
    );

    // KB endpoints should have been called
    const kbStats = await get(baseUrl, "/v1/debug/kb-stats");
    assert.equal(kbStats.res.status, 200, "/v1/debug/kb-stats should exist");
    assert.equal(kbStats.json.kbEnhanceEnabled, true, "kbEnhanceEnabled should be true in debug stats");

    // topic-match path (03a): anchor via topics_match, then expand via topic_neighbors.
    assert.ok(kbMock.callCountFor("topics_match") >= 1, "topics_match should have been called");
    assert.ok(kbMock.callCountFor("topic_neighbors") >= 1, "topic_neighbors should have been called");
    // graphrag is removed from the topic-match path (03a) — must not be called.
    assert.equal(kbMock.callCountFor("graphrag"), 0, "graphrag should NOT be called in the topic-match path");

    // keyword_resolve_batch should have been called (Phase 2 + Phase 7)
    assert.ok(kbMock.callCountFor("keyword_resolve_batch") >= 1, "keyword_resolve_batch should have been called");
  } finally {
    await server?.stop?.();
    await kbMock.stop();
    for (const f of [dbPath, `${dbPath}-wal`, `${dbPath}-shm`]) await rm(f, { force: true });
  }
});

// ─── Scenario 2: KB down — graceful degradation ──────────────────────────────

integrationTest("scenario 2: KB down — chat still answers using only cataloguesearch", async () => {
  const kbMock = createKbMock();
  let server;
  let baseUrl;
  const dbPath = os.tmpdir() + `/kb-test-s2-${process.pid}-${Date.now()}.db`;

  try {
    const kbBaseUrl = await kbMock.start();

    // All KB endpoints return 500
    kbMock.setAllError(500);

    server = createServer({
      testMode: true,
      cleanSessionDb: false,
      chatDbPath: dbPath,
      port: 0,
      host: "127.0.0.1",
      kbEnhanceEnabled: true,
      kbApiBaseUrl: kbBaseUrl,
      kbApiCoreBaseUrl: kbBaseUrl,
      kbApiTimeoutMs: 2000,
    });
    await server.start({ port: 0, host: "127.0.0.1" });
    baseUrl = server.getBaseUrl();

    const session = await post(baseUrl, "/v1/chat/sessions", {});
    const result = await post(baseUrl, `/v1/chat/sessions/${session.json.session_id}/messages`, {
      role: "user",
      content: "JAIN_QUESTION आत्मा क्या है?",
      response_format: "structured",
    });

    // Despite KB being down, the answer should succeed (graceful degradation)
    assert.equal(result.res.status, 200, "request should succeed even when KB is down");
    assert.equal(typeof result.json.answer, "string", "answer should be present");

    // kb was called but errored — kbCallErrorCount should be > 0 in debug stats
    const kbStats = await get(baseUrl, "/v1/debug/kb-stats");
    const stats = kbStats.json.stats;
    const totalErrors = Object.values(stats).reduce((sum, s) => sum + (s.errorCount || 0), 0);
    assert.ok(totalErrors > 0, "some KB calls should have errored");
  } finally {
    await server?.stop?.();
    await kbMock.stop();
    for (const f of [dbPath, `${dbPath}-wal`, `${dbPath}-shm`]) await rm(f, { force: true });
  }
});

// ─── Scenario 3: KB master flag disabled — no KB calls made ─────────────────

integrationTest("scenario 3: KB disabled (master flag off) — no KB calls are made", async () => {
  const kbMock = createKbMock();
  let server;
  let baseUrl;
  const dbPath = os.tmpdir() + `/kb-test-s3-${process.pid}-${Date.now()}.db`;

  try {
    const kbBaseUrl = await kbMock.start();

    server = createServer({
      testMode: true,
      cleanSessionDb: false,
      chatDbPath: dbPath,
      port: 0,
      host: "127.0.0.1",
      kbEnhanceEnabled: false, // master flag OFF
      kbApiBaseUrl: kbBaseUrl,
    });
    await server.start({ port: 0, host: "127.0.0.1" });
    baseUrl = server.getBaseUrl();

    const session = await post(baseUrl, "/v1/chat/sessions", {});
    const result = await post(baseUrl, `/v1/chat/sessions/${session.json.session_id}/messages`, {
      role: "user",
      content: "JAIN_QUESTION आत्मा क्या है?",
      response_format: "structured",
    });

    assert.equal(result.res.status, 200, "request should succeed");
    assert.equal(typeof result.json.answer, "string", "answer should be present");

    // No KB calls should have been made
    assert.equal(kbMock.totalCallCount(), 0, "no KB endpoints should be called when master flag is off");

    // debug endpoint should show kbEnhanceEnabled false
    const kbStats = await get(baseUrl, "/v1/debug/kb-stats");
    assert.equal(kbStats.json.kbEnhanceEnabled, false, "debug stats should reflect kbEnhanceEnabled=false");
  } finally {
    await server?.stop?.();
    await kbMock.stop();
    for (const f of [dbPath, `${dbPath}-wal`, `${dbPath}-shm`]) await rm(f, { force: true });
  }
});

// ─── Scenario 4: Per-phase flag — definitions disabled ───────────────────────

integrationTest("scenario 4: KB_ENHANCE_DEFINITIONS=false — keyword_resolve_batch not called for definitions", async () => {
  // Temporarily disable the definitions phase flag
  const origDef = process.env.KB_ENHANCE_DEFINITIONS;
  const origKwResolve = process.env.KB_ENHANCE_KEYWORD_RESOLVE;
  process.env.KB_ENHANCE_DEFINITIONS = "false";
  process.env.KB_ENHANCE_KEYWORD_RESOLVE = "false"; // also disable phase 2 to isolate

  const kbMock = createKbMock();
  let server;
  let baseUrl;
  const dbPath = os.tmpdir() + `/kb-test-s4-${process.pid}-${Date.now()}.db`;

  try {
    const kbBaseUrl = await kbMock.start();

    kbMock.setBehavior("topics_match", { body: kbTopicsMatchResponse });
    kbMock.setBehavior("topic_neighbors", { body: kbTopicNeighborsResponse });

    server = createServer({
      testMode: true,
      cleanSessionDb: false,
      chatDbPath: dbPath,
      port: 0,
      host: "127.0.0.1",
      kbEnhanceEnabled: true,
      kbApiBaseUrl: kbBaseUrl,
      kbApiCoreBaseUrl: kbBaseUrl,
      kbApiTimeoutMs: 3000,
    });
    await server.start({ port: 0, host: "127.0.0.1" });
    baseUrl = server.getBaseUrl();

    const session = await post(baseUrl, "/v1/chat/sessions", {});
    const result = await post(baseUrl, `/v1/chat/sessions/${session.json.session_id}/messages`, {
      role: "user",
      content: "JAIN_QUESTION आत्मा क्या है?",
      response_format: "structured",
    });

    assert.equal(result.res.status, 200);

    const kbStats = await get(baseUrl, "/v1/debug/kb-stats");

    // With definitions disabled and keyword_resolve disabled, keyword_resolve_batch should
    // only be called 0 times (no Phase 2 or Phase 7 calls)
    assert.equal(kbMock.callCountFor("keyword_resolve_batch"), 0, "keyword_resolve_batch should not be called when both definition and keyword resolve phases are off");

    // topics_match (and its topic_neighbors expansion) should still run (topicMatch phase enabled)
    assert.ok(kbMock.callCountFor("topics_match") >= 1, "topics_match should still be called (topicMatch phase enabled)");

    // Per-phase flags in debug response
    assert.equal(kbStats.json.kbPhaseFlags.definitions, false, "definitions phase flag should be false");
    assert.equal(kbStats.json.kbPhaseFlags.keywordResolve, false, "keywordResolve phase flag should be false");
    assert.equal(kbStats.json.kbPhaseFlags.topicMatch, true, "topicMatch phase flag should still be true");
  } finally {
    await server?.stop?.();
    await kbMock.stop();
    for (const f of [dbPath, `${dbPath}-wal`, `${dbPath}-shm`]) await rm(f, { force: true });
    // Restore env
    if (origDef === undefined) delete process.env.KB_ENHANCE_DEFINITIONS;
    else process.env.KB_ENHANCE_DEFINITIONS = origDef;
    if (origKwResolve === undefined) delete process.env.KB_ENHANCE_KEYWORD_RESOLVE;
    else process.env.KB_ENHANCE_KEYWORD_RESOLVE = origKwResolve;
  }
});

// ─── Scenario 5: Backward compat — old agent API (no guided_results) ─────────

integrationTest("scenario 5: backward compat — old agent API without guided_results still produces a valid answer", async () => {
  const kbMock = createKbMock();
  let server;
  let baseUrl;
  const dbPath = os.tmpdir() + `/kb-test-s5-${process.pid}-${Date.now()}.db`;

  try {
    const kbBaseUrl = await kbMock.start();

    // KB returns topics with references (which would normally generate guided_filters)
    kbMock.setBehavior("topics_match", { body: kbTopicsMatchResponse });
    kbMock.setBehavior("topic_neighbors", { body: kbTopicNeighborsResponse });
    kbMock.setBehavior("keyword_resolve_batch", { body: kbKeywordResolveResponse });

    server = createServer({
      testMode: true,
      cleanSessionDb: false,
      chatDbPath: dbPath,
      port: 0,
      host: "127.0.0.1",
      kbEnhanceEnabled: true,
      kbApiBaseUrl: kbBaseUrl,
      kbApiCoreBaseUrl: kbBaseUrl,
      kbApiTimeoutMs: 3000,
    });
    await server.start({ port: 0, host: "127.0.0.1" });
    baseUrl = server.getBaseUrl();

    // The test external API client (buildTestExternalApiClient) returns guided_results: []
    // which simulates the backward-compat path where the agent API doesn't return guided_results.
    const session = await post(baseUrl, "/v1/chat/sessions", {});
    const result = await post(baseUrl, `/v1/chat/sessions/${session.json.session_id}/messages`, {
      role: "user",
      content: "JAIN_QUESTION आत्मा क्या है?",
      response_format: "structured",
    });

    assert.equal(result.res.status, 200, "request should succeed with old agent API");
    assert.equal(typeof result.json.answer, "string", "answer should be present");
    // References from KB topics might be derived as guided_filters, but since old API
    // returns empty guided_results, there should be no guided passages section breaking things
    assert.ok(Array.isArray(result.json.references), "references should be an array");
  } finally {
    await server?.stop?.();
    await kbMock.stop();
    for (const f of [dbPath, `${dbPath}-wal`, `${dbPath}-shm`]) await rm(f, { force: true });
  }
});

// ─── Scenario 6: Phase 3 — topic extracts + neighbors reach Step2 context ────

integrationTest("scenario 6: topic extracts, nested related topics, and related keyword definitions reach the Step2 context", async () => {
  await withKbServer({
    content: "JAIN_QUESTION आत्मा क्या है?",
    behaviors: {
      topics_match: kbTopicsMatchResponse,
      topic_neighbors: kbTopicNeighborsWithRelated,
      keyword_resolve_batch: kbKeywordResolveResponse,
    },
  }, ({ result, context, kbMock }) => {
    assert.equal(result.res.status, 200);
    assert.ok(context.includes("### KB Topics"), "KB Topics section should be in the synthesis context");
    assert.ok(context.includes("आत्मा का स्वरूप"), "anchor topic display name should be present");
    assert.ok(context.includes("आत्मा नित्य है।"), "topic Hindi extract should be present");
    assert.ok(context.includes("ref: shastra=समयसार, गाथा=1"), "anchor extract ref should be rendered");
    assert.ok(context.includes("related topic (hop 1): आत्मा का लक्षण"), "related topic should be nested");
    assert.ok(context.includes("extract: आत्मा ज्ञाता-द्रष्टा है।"), "related topic extract should be rendered");
    assert.ok(context.includes("ref: shastra=प्रवचनसार, गाथा=2"), "related topic ref should be rendered");
    assert.ok(context.includes("related keyword: आत्मा"), "related keyword should be rendered");
    assert.ok(context.includes("definition: आत्मा: जीव का शुद्ध स्वरूप।"), "related keyword definition should be rendered");
    assert.ok(kbMock.callCountFor("topic_neighbors") >= 1, "topic_neighbors should have been called");
    const topicsMatchBody = kbMock.callsFor("topics_match").at(-1)?.body;
    const topicNeighborsBody = kbMock.callsFor("topic_neighbors").at(-1)?.body;
    assert.equal(topicsMatchBody.content_only, true, "topics_match should request content-only anchors");
    assert.equal(topicNeighborsBody.max_hops, 2, "topic_neighbors should request 2-hop expansion");
  });
});

// ─── Scenario 7: Phase 5 — metadata matches reach context (real {items} shape)

integrationTest("scenario 7: metadata question — KB metadata matches (from {items}+title[]) reach the context", async () => {
  await withKbServer({
    content: "METADATA_QUESTION समयसार के लेखक कौन हैं?",
    behaviors: {
      shastras: kbShastrasResponse,
      authors: kbAuthorsResponse,
    },
  }, ({ result, context, kbMock }) => {
    assert.equal(result.res.status, 200);
    assert.ok(context.includes("### KB Metadata Matches"), "metadata section should be injected");
    // Name derived from title[]/display_name[] — not the raw envelope.
    assert.ok(context.includes("समयसार") && context.includes("nk=समयसार"), "shastra match name + nk should render");
    assert.ok(context.includes("कुन्दकुन्दाचार्य"), "author match name should render from display_name[]");
    assert.ok(!context.includes("[object Object]"), "no unrendered objects in context");
    assert.ok(kbMock.callCountFor("shastras") >= 1, "shastras endpoint should be called");
    assert.ok(kbMock.callCountFor("authors") >= 1, "authors endpoint should be called");
    // Metadata workflow excludes topic-match / definitions.
    assert.equal(kbMock.callCountFor("topics_match"), 0, "topics_match skipped for metadata workflow");
  });
});

// ─── Scenario 8: Phase 6 — sub-workflows dispatch + clean context rendering ──

integrationTest("scenario 8: sub-workflows — topic_in_shastra & shastra_for_topics render cleanly in context", async () => {
  await withKbServer({
    content: "SUBWORKFLOW_QUESTION द्रव्य के बारे में बताइये",
    behaviors: {
      // shastras is hit to canonicalize the shastra natural_key.
      shastras: kbShastrasResponse,
      topics_in_shastra: kbTopicsInShastraResponse,
      shastras_for_topic: kbShastrasForTopicResponse,
      topics_match: kbTopicsMatchResponse,
      topic_neighbors: kbTopicNeighborsResponse,
      keyword_resolve_batch: kbKeywordResolveResponse,
    },
  }, ({ result, context, kbMock }) => {
    assert.equal(result.res.status, 200);
    assert.ok(context.includes("### KB Sub-workflow Results"), "sub-workflow section should be injected");
    assert.ok(context.includes("[search_topic_in_shastra]"), "topic_in_shastra entry present");
    assert.ok(context.includes("[search_shastra_for_topics]"), "shastra_for_topics entry present");
    assert.ok(context.includes("धवला"), "shastra name_hi/natural_key should render (not [object Object])");
    assert.ok(context.includes("gathas 12"), "gatha number should render from {number} object");
    assert.ok(!context.includes("[object Object]"), "no unrendered objects");
    assert.ok(kbMock.callCountFor("topics_in_shastra") >= 1, "topics_in_shastra called");
    assert.ok(kbMock.callCountFor("shastras_for_topic") >= 1, "shastras_for_topic called");
  });
});

// ─── Scenario 9: Phase 2 — keyword miss with suggestions does not break flow ─

integrationTest("scenario 9: keyword_resolve miss with suggestions — pipeline still answers and rewrites canonically", async () => {
  const kbKeywordResolveMiss = {
    resolutions: [
      {
        input_token: "आत्मा",
        keyword_natural_key: null,
        match_kind: "none",
        suggestions: [
          { keyword_natural_key: "आत्मा", display_text_hi: "आत्मा", similarity: 0.82 },
        ],
        definitions: [],
      },
    ],
    tool_trace_id: "mock-trace-miss",
  };
  await withKbServer({
    content: "JAIN_QUESTION आत्मा क्या है?",
    behaviors: {
      topics_match: kbTopicsMatchResponse,
      topic_neighbors: kbTopicNeighborsResponse,
      keyword_resolve_batch: kbKeywordResolveMiss,
    },
  }, ({ result, kbMock }) => {
    assert.equal(result.res.status, 200, "request should still succeed on a keyword miss");
    assert.equal(typeof result.json.answer, "string", "answer present");
    assert.ok(kbMock.callCountFor("keyword_resolve_batch") >= 1, "keyword_resolve_batch should be called");
  });
});

// ─── Scenario 10: Per-phase — topicMatch off, keyword resolve still runs ─────

integrationTest("scenario 10: KB_ENHANCE_TOPIC_MATCH=false — topics_match not called, keyword_resolve still runs", async () => {
  await withKbServer({
    content: "JAIN_QUESTION आत्मा क्या है?",
    env: { KB_ENHANCE_TOPIC_MATCH: "false" },
    behaviors: {
      topics_match: kbTopicsMatchResponse,
      topic_neighbors: kbTopicNeighborsResponse,
      keyword_resolve_batch: kbKeywordResolveResponse,
    },
  }, ({ result, context, kbMock, kbStats }) => {
    assert.equal(result.res.status, 200);
    assert.equal(kbMock.callCountFor("topics_match"), 0, "topics_match must not be called when topicMatch phase off");
    assert.equal(kbMock.callCountFor("topic_neighbors"), 0, "topic_neighbors must not be called either");
    assert.ok(kbMock.callCountFor("keyword_resolve_batch") >= 1, "keyword_resolve still runs");
    assert.ok(!context.includes("### KB Topics"), "no KB Topics section when topic match disabled");
    assert.equal(kbStats.kbPhaseFlags.topicMatch, false, "debug stats reflect topicMatch=false");
  });
});

// ─── Scenario 11: Per-phase — metadata phase off, resource endpoints not hit ─

integrationTest("scenario 11: KB_ENHANCE_METADATA=false — metadata workflow makes no shastras/authors calls", async () => {
  await withKbServer({
    content: "METADATA_QUESTION समयसार के लेखक कौन हैं?",
    env: { KB_ENHANCE_METADATA: "false" },
    behaviors: { shastras: kbShastrasResponse, authors: kbAuthorsResponse },
  }, ({ result, context, kbMock }) => {
    assert.equal(result.res.status, 200);
    assert.equal(kbMock.callCountFor("shastras"), 0, "shastras must not be called when metadata phase off");
    assert.equal(kbMock.callCountFor("authors"), 0, "authors must not be called when metadata phase off");
    assert.ok(!context.includes("### KB Metadata Matches"), "no metadata section when phase off");
  });
});

// ─── Scenario 12: Definitions reach context as a cited KB section ────────────

integrationTest("scenario 12: jain keyword definition is injected into the Step2 context and cited", async () => {
  await withKbServer({
    content: "JAIN_QUESTION आत्मा क्या है?",
    behaviors: {
      topics_match: kbTopicsMatchResponse,
      topic_neighbors: kbTopicNeighborsResponse,
      keyword_resolve_batch: kbKeywordResolveResponse,
    },
  }, ({ result, context }) => {
    assert.equal(result.res.status, 200);
    // Definition text + a KB-D citation id should be present in the context.
    assert.ok(context.includes("आत्मा: जीव का शुद्ध स्वरूप।"), "definition text should be in context");
    assert.ok(/KB-D-\d+/.test(context), "a KB-D definition citation id should be present");
    // And the definition's jainkosh source_url should surface in references.
    assert.ok(
      result.json.references.some((r) => String(r).includes("https://www.jainkosh.org/wiki/आत्मा") && !String(r).includes("#")),
      "definition source_url merged into references"
    );
  });
});

// ─── Scenario 13: direct_retrieval_only=true — topic match + guided filters skipped ─

integrationTest("scenario 13: direct_retrieval_only — topics_match/topic_neighbors skipped, no KB Topics section", async () => {
  await withKbServer({
    content: "DIRECT_RETRIEVAL_QUESTION समयसार गाथा 6 की टीका बताओ",
    behaviors: {
      shastras: kbShastrasResponse,
      topics_match: kbTopicsMatchResponse,
      topic_neighbors: kbTopicNeighborsResponse,
      keyword_resolve_batch: kbKeywordResolveResponse,
    },
  }, ({ result, context, kbMock }) => {
    assert.equal(result.res.status, 200);
    // Phase 3 (topic match) and Phase 4 (guided filters) must be skipped.
    assert.equal(kbMock.callCountFor("topics_match"), 0, "topics_match skipped for direct_retrieval_only");
    assert.equal(kbMock.callCountFor("topic_neighbors"), 0, "topic_neighbors skipped for direct_retrieval_only");
    assert.ok(!context.includes("### KB Topics"), "no KB Topics section for direct_retrieval_only");
    assert.ok(!context.includes("### Guided Passages"), "no Guided Passages section for direct_retrieval_only");
  });
});

// ─── Scenario 14: combined query (direct_retrieval_only=false) — topics still fetched ─

integrationTest("scenario 14: combined direct + conceptual query — topic match still runs", async () => {
  await withKbServer({
    content: "DIRECT_RETRIEVAL_QUESTION COMBINED समयसार गाथा 6 का सारांश, इसमें आत्मा की स्वतंत्रता पर क्या कहा गया है?",
    behaviors: {
      shastras: kbShastrasResponse,
      topics_match: kbTopicsMatchResponse,
      topic_neighbors: kbTopicNeighborsResponse,
      keyword_resolve_batch: kbKeywordResolveResponse,
    },
  }, ({ result, context, kbMock }) => {
    assert.equal(result.res.status, 200);
    assert.ok(kbMock.callCountFor("topics_match") >= 1, "topics_match should run for combined query");
    assert.ok(context.includes("### KB Topics"), "KB Topics section present for combined query");
  });
});
