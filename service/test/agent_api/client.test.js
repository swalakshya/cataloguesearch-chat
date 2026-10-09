import { test } from "node:test";
import assert from "node:assert/strict";

import { ExternalApiClient } from "../../src/agent_api/client.js";

test("accuracy searches get enough transport time for the larger rerank pool", async () => {
  const originalFetch = global.fetch;
  const originalSetTimeout = global.setTimeout;
  const delays = [];
  global.setTimeout = (fn, delay, ...args) => { delays.push(delay); return originalSetTimeout(fn, delay, ...args); };
  global.fetch = async () => ({ ok: true, status: 200, text: async () => "[]" });
  try {
    const client = new ExternalApiClient({ baseUrl: "http://example.com", timeoutMs: 60_000 });
    await client.search({ query: "q", accuracy_mode: true }, "accuracy");
    await client.search({ query: "q", accuracy_mode: false }, "standard");
    assert.deepEqual(delays, [90_000, 60_000]);
  } finally {
    global.fetch = originalFetch;
    global.setTimeout = originalSetTimeout;
  }
});

test("ExternalApiClient normalizes baseUrl and posts payload", async () => {
  const originalFetch = global.fetch;
  const calls = [];
  global.fetch = async (url, options) => {
    calls.push({ url, options });
    return {
      ok: true,
      status: 200,
      text: async () => "[]",
    };
  };

  try {
    const client = new ExternalApiClient({ baseUrl: "http://example.com/", timeoutMs: 50 });
    await client.search({ query: "q", content_type: ["Pravachan"] }, "r1");

    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, "http://example.com/api/agent/search");
    const body = JSON.parse(calls[0].options.body);
    assert.equal(body.query, "q");
    assert.deepEqual(body.content_type, ["Pravachan"]);
  } finally {
    global.fetch = originalFetch;
  }
});

test("ExternalApiClient forces language to hi when invalid", async () => {
  const originalFetch = global.fetch;
  const calls = [];
  global.fetch = async (url, options) => {
    calls.push({ url, options });
    return {
      ok: true,
      status: 200,
      text: async () => "[]",
    };
  };

  try {
    const client = new ExternalApiClient({ baseUrl: "http://example.com", timeoutMs: 50 });
    await client.search({ query: "q", language: "en" }, "r1");
    const body = JSON.parse(calls[0].options.body);
    assert.equal(body.language, "hi");
  } finally {
    global.fetch = originalFetch;
  }
});

test("ExternalApiClient preserves mixed content types unchanged", async () => {
  const originalFetch = global.fetch;
  const calls = [];
  global.fetch = async (url, options) => {
    calls.push({ url, options });
    return {
      ok: true,
      status: 200,
      text: async () => "[]",
    };
  };

  try {
    const client = new ExternalApiClient({ baseUrl: "http://example.com", timeoutMs: 50 });
    await client.search({ query: "q", content_type: ["Pravachan", "Books"] }, "r1");
    const body = JSON.parse(calls[0].options.body);
    assert.deepEqual(body.content_type, ["Pravachan", "Books"]);
  } finally {
    global.fetch = originalFetch;
  }
});
