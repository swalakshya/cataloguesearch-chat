import { test } from "node:test";
import assert from "node:assert/strict";

import { ExternalApiClient } from "../../src/agent_api/client.js";

function mockFetch(responseText, { ok = true, status = 200 } = {}) {
  const original = global.fetch;
  const calls = [];
  global.fetch = async (url, options) => {
    calls.push({ url, options });
    return { ok, status, text: async () => responseText };
  };
  return { calls, restore: () => { global.fetch = original; } };
}

test("ExternalApiClient normalizes baseUrl and posts payload", async () => {
  const { calls, restore } = mockFetch("[]");
  try {
    const client = new ExternalApiClient({ baseUrl: "http://example.com/", timeoutMs: 50 });
    await client.search({ query: "q", content_type: ["Pravachan"] }, "r1");

    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, "http://example.com/api/agent/search");
    const body = JSON.parse(calls[0].options.body);
    assert.equal(body.query, "q");
    assert.deepEqual(body.content_type, ["Pravachan"]);
  } finally {
    restore();
  }
});

test("ExternalApiClient forces language to hi when invalid", async () => {
  const { calls, restore } = mockFetch("[]");
  try {
    const client = new ExternalApiClient({ baseUrl: "http://example.com", timeoutMs: 50 });
    await client.search({ query: "q", language: "en" }, "r1");
    const body = JSON.parse(calls[0].options.body);
    assert.equal(body.language, "hi");
  } finally {
    restore();
  }
});

test("ExternalApiClient preserves mixed content types unchanged", async () => {
  const { calls, restore } = mockFetch("[]");
  try {
    const client = new ExternalApiClient({ baseUrl: "http://example.com", timeoutMs: 50 });
    await client.search({ query: "q", content_type: ["Pravachan", "Books"] }, "r1");
    const body = JSON.parse(calls[0].options.body);
    assert.deepEqual(body.content_type, ["Pravachan", "Books"]);
  } finally {
    restore();
  }
});

// Guided search no longer alters the agent API contract: search() returns the
// raw response unchanged. Per-guided-filter retrieval is done chat-side by
// firing separate search() calls (see kb_guided_filters.fetchGuidedResults).
test("search() returns the raw flat array response unchanged", async () => {
  const chunks = [{ chunk_id: "c1" }, { chunk_id: "c2" }];
  const { restore } = mockFetch(JSON.stringify(chunks));
  try {
    const client = new ExternalApiClient({ baseUrl: "http://example.com", timeoutMs: 50 });
    const result = await client.search({ query: "q" }, "r1");
    assert.deepEqual(result, chunks);
  } finally {
    restore();
  }
});

test("search() returns [] on empty response", async () => {
  const { restore } = mockFetch("");
  try {
    const client = new ExternalApiClient({ baseUrl: "http://example.com", timeoutMs: 50 });
    const result = await client.search({ query: "q" }, "r1");
    assert.deepEqual(result, []);
  } finally {
    restore();
  }
});
