import { test } from "node:test";
import assert from "node:assert/strict";

import { fetchKbMetadataMatches, buildKbMetadataSection } from "../../src/orchestrator/kb_metadata_match.js";

// ─── buildKbMetadataSection ───────────────────────────────────────────────────

test("buildKbMetadataSection: null returns empty string", () => {
  assert.equal(buildKbMetadataSection(null), "");
});

test("buildKbMetadataSection: empty matches returns empty string", () => {
  assert.equal(buildKbMetadataSection({ shastraMatches: [], authorMatches: [] }), "");
});

test("buildKbMetadataSection: shastra match rendered correctly", () => {
  const section = buildKbMetadataSection({
    shastraMatches: [{ name: "समयसार", natural_key: "samaysaar", similarity: 0.78 }],
    authorMatches: [],
  });
  assert.ok(section.includes("### KB Metadata Matches (closest first)"), "heading present");
  assert.ok(section.includes("shastra: समयसार (nk=samaysaar, sim=0.78)"), "shastra line present");
});

test("buildKbMetadataSection: author match rendered correctly", () => {
  const section = buildKbMetadataSection({
    shastraMatches: [],
    authorMatches: [{ name: "Pandit Jaychand Chhabbra", natural_key: "jaychand_chhabbra", similarity: 0.71 }],
  });
  assert.ok(section.includes("author:  Pandit Jaychand Chhabbra (nk=jaychand_chhabbra, sim=0.71)"), "author line present");
});

test("buildKbMetadataSection: both shastra and author matches present", () => {
  const section = buildKbMetadataSection({
    shastraMatches: [{ name: "समयसार", natural_key: "samaysaar", similarity: 0.78 }],
    authorMatches: [{ name: "Kundkund", natural_key: "kundkund", similarity: 0.65 }],
  });
  assert.ok(section.includes("shastra: समयसार"), "shastra present");
  assert.ok(section.includes("author:  Kundkund"), "author present");
});

test("buildKbMetadataSection: omits sim when similarity is null", () => {
  const section = buildKbMetadataSection({
    shastraMatches: [{ name: "समयसार", natural_key: "samaysaar", similarity: null }],
    authorMatches: [],
  });
  assert.ok(section.includes("shastra: समयसार (nk=samaysaar)"), "no sim when null");
  assert.ok(!section.includes("sim="), "no sim field");
});

// ─── fetchKbMetadataMatches ────────────────────────────────────────────────────

test("fetchKbMetadataMatches: returns null when kbApiClient is null", async () => {
  const result = await fetchKbMetadataMatches(null, { shastra_hints: ["samaysaar"], author_hints: [] }, "r1");
  assert.equal(result, null);
});

test("fetchKbMetadataMatches: returns null when kbEntities is null", async () => {
  const kbApiClient = { shastras: async () => [], authors: async () => [] };
  const result = await fetchKbMetadataMatches(kbApiClient, null, "r1");
  assert.equal(result, null);
});

test("fetchKbMetadataMatches: returns null when no hints present", async () => {
  const kbApiClient = { shastras: async () => [], authors: async () => [] };
  const result = await fetchKbMetadataMatches(kbApiClient, { shastra_hints: [], author_hints: [] }, "r1");
  assert.equal(result, null);
});

test("fetchKbMetadataMatches: fires shastras call per hint and returns results", async () => {
  const calls = [];
  const kbApiClient = {
    shastras: async ({ q }) => {
      calls.push({ type: "shastra", q });
      return [{ name: "समयसार", natural_key: "samaysaar", similarity: 0.9 }];
    },
    authors: async () => [],
  };

  const result = await fetchKbMetadataMatches(
    kbApiClient,
    { shastra_hints: ["samaysaar"], author_hints: [] },
    "r1"
  );

  assert.equal(calls.length, 1);
  assert.equal(calls[0].q, "samaysaar");
  assert.equal(result.shastraMatches.length, 1);
  assert.equal(result.shastraMatches[0].natural_key, "samaysaar");
  assert.deepEqual(result.authorMatches, []);
});

test("fetchKbMetadataMatches: fires authors call per hint and returns results", async () => {
  const calls = [];
  const kbApiClient = {
    shastras: async () => [],
    authors: async ({ q }) => {
      calls.push({ type: "author", q });
      return [{ name: "Kundkund", natural_key: "kundkund", similarity: 0.8 }];
    },
  };

  const result = await fetchKbMetadataMatches(
    kbApiClient,
    { shastra_hints: [], author_hints: ["kundkund"] },
    "r1"
  );

  assert.equal(calls.length, 1);
  assert.equal(calls[0].q, "kundkund");
  assert.deepEqual(result.shastraMatches, []);
  assert.equal(result.authorMatches.length, 1);
});

test("fetchKbMetadataMatches: fires both calls in parallel for multiple hints", async () => {
  const calls = [];
  const kbApiClient = {
    shastras: async ({ q }) => {
      calls.push({ type: "shastra", q });
      return [{ name: q, natural_key: q, similarity: 0.8 }];
    },
    authors: async ({ q }) => {
      calls.push({ type: "author", q });
      return [{ name: q, natural_key: q, similarity: 0.7 }];
    },
  };

  const result = await fetchKbMetadataMatches(
    kbApiClient,
    { shastra_hints: ["samaysaar", "pravachansar"], author_hints: ["kundkund"] },
    "r1"
  );

  assert.equal(calls.filter((c) => c.type === "shastra").length, 2);
  assert.equal(calls.filter((c) => c.type === "author").length, 1);
  assert.equal(result.shastraMatches.length, 2);
  assert.equal(result.authorMatches.length, 1);
});

test("fetchKbMetadataMatches: deduplicates by natural_key across hints", async () => {
  const kbApiClient = {
    shastras: async () => [{ name: "समयसार", natural_key: "samaysaar", similarity: 0.9 }],
    authors: async () => [],
  };

  const result = await fetchKbMetadataMatches(
    kbApiClient,
    { shastra_hints: ["samaysaar", "samaysaar_alias"], author_hints: [] },
    "r1"
  );

  assert.equal(result.shastraMatches.length, 1, "deduped to one entry");
});

test("fetchKbMetadataMatches: shastras call timeout degrades silently", async () => {
  const kbApiClient = {
    shastras: async () => { throw new Error("AbortError: timeout"); },
    authors: async () => [],
  };

  const result = await fetchKbMetadataMatches(
    kbApiClient,
    { shastra_hints: ["samaysaar"], author_hints: [] },
    "r1"
  );

  assert.ok(result !== null, "should still return a result object");
  assert.deepEqual(result.shastraMatches, [], "empty on timeout");
  assert.deepEqual(result.authorMatches, []);
});

test("fetchKbMetadataMatches: authors call failure degrades silently, other calls succeed", async () => {
  const kbApiClient = {
    shastras: async () => [{ name: "समयसार", natural_key: "samaysaar", similarity: 0.9 }],
    authors: async () => { throw new Error("authors API error"); },
  };

  const result = await fetchKbMetadataMatches(
    kbApiClient,
    { shastra_hints: ["samaysaar"], author_hints: ["kundkund"] },
    "r1"
  );

  assert.equal(result.shastraMatches.length, 1, "shastra still returned");
  assert.deepEqual(result.authorMatches, [], "authors empty on failure");
});
