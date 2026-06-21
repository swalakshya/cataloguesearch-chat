import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";

// Helper to reload the module with fresh env vars.
// Since Node ESM caches modules we spy by reimporting with dynamic import
// and restoring env after.
function withEnv(envOverrides, fn) {
  const originals = {};
  for (const [k, v] of Object.entries(envOverrides)) {
    originals[k] = process.env[k];
    if (v === undefined) {
      delete process.env[k];
    } else {
      process.env[k] = String(v);
    }
  }
  return async () => {
    try {
      await fn();
    } finally {
      for (const [k, v] of Object.entries(originals)) {
        if (v === undefined) {
          delete process.env[k];
        } else {
          process.env[k] = v;
        }
      }
    }
  };
}

// Because kb_config.js reads env at module load time, we need to test it by
// creating fresh module instances via dynamic import with cache-busting.
async function loadKbConfig(envOverrides = {}) {
  const originals = {};
  for (const [k, v] of Object.entries(envOverrides)) {
    originals[k] = process.env[k];
    if (v === undefined) {
      delete process.env[k];
    } else {
      process.env[k] = String(v);
    }
  }
  try {
    // Cache-bust by appending a unique query param (works in Node ESM)
    const { KB_PHASE_FLAGS, KB_ENDPOINTS, KB_CAPS_DEFAULTS, getKbWorkflowConfig } =
      await import(`../../src/config/kb_config.js?t=${Date.now()}_${Math.random()}`);
    return { KB_PHASE_FLAGS, KB_ENDPOINTS, KB_CAPS_DEFAULTS, getKbWorkflowConfig };
  } finally {
    for (const [k, v] of Object.entries(originals)) {
      if (v === undefined) {
        delete process.env[k];
      } else {
        process.env[k] = v;
      }
    }
  }
}

// ─── Static import for structural tests ──────────────────────────────────────

import { KB_PHASE_FLAGS, KB_ENDPOINTS, KB_CAPS_DEFAULTS, getKbWorkflowConfig } from "../../src/config/kb_config.js";

// ─── KB_PHASE_FLAGS structure ─────────────────────────────────────────────────

describe("KB_PHASE_FLAGS", () => {
  test("exports all required phase flag keys", () => {
    const keys = ["masterEnabled", "keywordResolve", "topicMatch", "guidedFilters", "metadata", "subworkflows", "definitions"];
    for (const key of keys) {
      assert.ok(key in KB_PHASE_FLAGS, `missing key: ${key}`);
      assert.equal(typeof KB_PHASE_FLAGS[key], "boolean", `${key} should be boolean`);
    }
  });

  test("masterEnabled defaults to false when KB_ENHANCE_ENABLED is absent", () => {
    // In the test env KB_ENHANCE_ENABLED is not set, so it should be false
    assert.equal(KB_PHASE_FLAGS.masterEnabled, false);
  });

  test("all phase flags default to false when master is false (no env overrides)", () => {
    // All sub-flags should default to masterEnabled (false)
    assert.equal(KB_PHASE_FLAGS.keywordResolve, false);
    assert.equal(KB_PHASE_FLAGS.topicMatch, false);
    assert.equal(KB_PHASE_FLAGS.guidedFilters, false);
    assert.equal(KB_PHASE_FLAGS.metadata, false);
    assert.equal(KB_PHASE_FLAGS.subworkflows, false);
    assert.equal(KB_PHASE_FLAGS.definitions, false);
  });
});

// ─── KB_ENDPOINTS structure ───────────────────────────────────────────────────

describe("KB_ENDPOINTS", () => {
  test("exports all required endpoint keys", () => {
    const keys = ["serviceBaseUrl", "coreServiceBaseUrl", "requestTimeoutMs", "requestMaxRetries"];
    for (const key of keys) {
      assert.ok(key in KB_ENDPOINTS, `missing key: ${key}`);
    }
  });

  test("serviceBaseUrl defaults to http://localhost:8004", () => {
    assert.equal(KB_ENDPOINTS.serviceBaseUrl, "http://localhost:8004");
  });

  test("requestTimeoutMs defaults to 15000 (15 sec)", () => {
    assert.equal(KB_ENDPOINTS.requestTimeoutMs, 15000);
  });

  test("requestMaxRetries defaults to 1", () => {
    assert.equal(KB_ENDPOINTS.requestMaxRetries, 1);
  });
});

// ─── KB_CAPS_DEFAULTS structure ───────────────────────────────────────────────

describe("KB_CAPS_DEFAULTS", () => {
  test("exports all required cap keys", () => {
    const keys = [
      "keyword_resolve_max_tokens", "keyword_fuzzy_top_k", "keyword_fuzzy_min_sim",
      "topic_match_limit", "graphrag_limit", "topic_merge_limit", "topic_extract_truncate_chars",
      "guided_filters_cap", "metadata_fuzzy_limit", "metadata_fuzzy_min_sim",
      "subworkflows_max", "subworkflow_timeout_ms", "definitions_max_keywords", "definitions_per_keyword",
    ];
    for (const key of keys) {
      assert.ok(key in KB_CAPS_DEFAULTS, `missing key: ${key}`);
    }
  });

  test("topic_match_limit defaults to 5", () => {
    assert.equal(KB_CAPS_DEFAULTS.topic_match_limit, 5);
  });

  test("graphrag_limit defaults to 5", () => {
    assert.equal(KB_CAPS_DEFAULTS.graphrag_limit, 5);
  });

  test("topic_merge_limit defaults to 5", () => {
    assert.equal(KB_CAPS_DEFAULTS.topic_merge_limit, 5);
  });

  test("definitions_max_keywords defaults to 15", () => {
    assert.equal(KB_CAPS_DEFAULTS.definitions_max_keywords, 15);
  });

  test("definitions_per_keyword defaults to 0 (all)", () => {
    assert.equal(KB_CAPS_DEFAULTS.definitions_per_keyword, 0);
  });

  test("subworkflow_timeout_ms defaults to 10000", () => {
    assert.equal(KB_CAPS_DEFAULTS.subworkflow_timeout_ms, 10000);
  });

  test("keyword_fuzzy_min_sim defaults to 0.35", () => {
    assert.ok(Math.abs(KB_CAPS_DEFAULTS.keyword_fuzzy_min_sim - 0.35) < 0.001);
  });

  test("metadata_fuzzy_min_sim defaults to 0.25", () => {
    assert.ok(Math.abs(KB_CAPS_DEFAULTS.metadata_fuzzy_min_sim - 0.25) < 0.001);
  });
});

// ─── getKbWorkflowConfig ──────────────────────────────────────────────────────

describe("getKbWorkflowConfig", () => {
  test("returns env defaults when no model id given", () => {
    const config = getKbWorkflowConfig(undefined);
    assert.equal(config.topic_match_limit, KB_CAPS_DEFAULTS.topic_match_limit);
    assert.equal(config.graphrag_limit, KB_CAPS_DEFAULTS.graphrag_limit);
    assert.equal(config.definitions_max_keywords, KB_CAPS_DEFAULTS.definitions_max_keywords);
  });

  test("returns env defaults for unknown model", () => {
    const config = getKbWorkflowConfig("unknown-model-xyz");
    assert.equal(config.topic_match_limit, KB_CAPS_DEFAULTS.topic_match_limit);
  });

  test("applies gpt-4o workflowOverrides.kb on top of env defaults", () => {
    const config = getKbWorkflowConfig("gpt-4o");
    // Per model_config.js gpt-4o has kb: { topic_match_limit: 3, graphrag_limit: 3, topic_merge_limit: 4, definitions_max_keywords: 10 }
    assert.equal(config.topic_match_limit, 3);
    assert.equal(config.graphrag_limit, 3);
    assert.equal(config.topic_merge_limit, 4);
    assert.equal(config.definitions_max_keywords, 10);
  });

  test("gpt-4o override does not affect non-overridden caps", () => {
    const config = getKbWorkflowConfig("gpt-4o");
    // guided_filters_cap is not in gpt-4o kb overrides, should use env default
    assert.equal(config.guided_filters_cap, KB_CAPS_DEFAULTS.guided_filters_cap);
    assert.equal(config.subworkflows_max, KB_CAPS_DEFAULTS.subworkflows_max);
  });

  test("models without kb overrides return pure env defaults", () => {
    const config = getKbWorkflowConfig("gemini-2.5-flash");
    assert.equal(config.topic_match_limit, KB_CAPS_DEFAULTS.topic_match_limit);
    assert.equal(config.definitions_max_keywords, KB_CAPS_DEFAULTS.definitions_max_keywords);
  });

  test("result is a plain flat object", () => {
    const config = getKbWorkflowConfig("gpt-4o");
    assert.equal(typeof config, "object");
    assert.ok(!Array.isArray(config));
    // Should have numeric values for numeric caps
    assert.equal(typeof config.topic_match_limit, "number");
  });
});

// ─── Logging shape verification ───────────────────────────────────────────────

describe("KbApiClient logging shape", () => {
  // Verify that kb_api_request and kb_api_response log entries contain the
  // fields required by the Phase 8 spec.
  test("kb_api_response log contains kb_endpoint, latency_ms, status, and requestId fields", async () => {
    const { KbApiClient } = await import("../../src/kb_api/client.js");
    const { log } = await import("../../src/utils/log.js");

    const loggedEntries = [];
    const origInfo = log.info;
    log.info = (event, data) => {
      loggedEntries.push({ event, ...data });
    };

    const original = global.fetch;
    global.fetch = async () => ({
      ok: true,
      status: 200,
      text: async () => JSON.stringify([{ natural_key: "samaysaar" }]),
    });

    try {
      const client = new KbApiClient({ baseUrl: "http://kb.example.com", timeoutMs: 500 });
      await client.shastras({ q: "samaysaar" }, "req-log-shape");

      const response = loggedEntries.find((e) => e.event === "kb_api_response");
      assert.ok(response, "kb_api_response log entry must exist");
      assert.ok("path" in response, "log must contain path (kb_endpoint)");
      assert.ok("durationMs" in response, "log must contain durationMs (latency_ms)");
      assert.ok("status" in response, "log must contain status");
      assert.ok("requestId" in response, "log must contain requestId (tool_trace_id)");
    } finally {
      log.info = origInfo;
      global.fetch = original;
    }
  });

  test("kb_api_failed log contains kb_endpoint, status, and requestId fields", async () => {
    const { KbApiClient } = await import("../../src/kb_api/client.js");
    const { log } = await import("../../src/utils/log.js");

    const loggedEntries = [];
    const origWarn = log.warn;
    log.warn = (event, data) => {
      loggedEntries.push({ event, ...data });
    };

    const original = global.fetch;
    global.fetch = async () => ({
      ok: false,
      status: 503,
      text: async () => "service unavailable",
    });

    try {
      const client = new KbApiClient({ baseUrl: "http://kb.example.com", timeoutMs: 500 });
      await client.shastras({ q: "x" }, "req-fail-shape").catch(() => {});

      const failEntry = loggedEntries.find((e) => e.event === "kb_api_failed");
      assert.ok(failEntry, "kb_api_failed log entry must exist");
      assert.ok("path" in failEntry, "log must contain path (kb_endpoint)");
      assert.ok("status" in failEntry, "log must contain status");
      assert.ok("requestId" in failEntry, "log must contain requestId");
    } finally {
      log.warn = origWarn;
      global.fetch = original;
    }
  });

  test("onCallComplete callback receives endpoint, durationMs, and success on success", async () => {
    const { KbApiClient } = await import("../../src/kb_api/client.js");

    const calls = [];
    const original = global.fetch;
    global.fetch = async () => ({
      ok: true,
      status: 200,
      text: async () => "[]",
    });

    try {
      const client = new KbApiClient({
        baseUrl: "http://kb.example.com",
        timeoutMs: 500,
        onCallComplete: (data) => calls.push(data),
      });
      await client.shastras({ q: "x" }, "r1");

      assert.equal(calls.length, 1);
      assert.equal(typeof calls[0].endpoint, "string");
      assert.ok(calls[0].endpoint.includes("/v1/shastras"), "endpoint must match path");
      assert.equal(typeof calls[0].durationMs, "number");
      assert.equal(calls[0].success, true);
    } finally {
      global.fetch = original;
    }
  });

  test("onCallComplete callback receives success=false on HTTP error", async () => {
    const { KbApiClient } = await import("../../src/kb_api/client.js");

    const calls = [];
    const original = global.fetch;
    global.fetch = async () => ({
      ok: false,
      status: 500,
      text: async () => "error",
    });

    try {
      const client = new KbApiClient({
        baseUrl: "http://kb.example.com",
        timeoutMs: 500,
        onCallComplete: (data) => calls.push(data),
      });
      await client.shastras({ q: "x" }, "r1").catch(() => {});

      assert.equal(calls.length, 1);
      assert.equal(calls[0].success, false);
    } finally {
      global.fetch = original;
    }
  });
});
