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
      extracts_hi: [{ block_index: 1, text_hi: "आत्मा नित्य है।" }],
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
