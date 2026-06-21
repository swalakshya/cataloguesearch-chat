import { test } from "node:test";
import assert from "node:assert/strict";

import { cleanChunk, cleanChunks, buildContext, extractChunkIds, buildMultiLangContext, buildGuidedContext } from "../../src/utils/chunk.js";

test("cleanChunk normalizes fields", () => {
  const chunk = cleanChunk({ chunk_id: "c1", file_url: "u", page_number: 1, text_content: "t" });
  assert.equal(chunk.id, "c1");
  assert.equal(chunk.t, "t");
  assert.equal(chunk.gatha, undefined);
  assert.equal(chunk.category, undefined);
});

test("cleanChunks de-duplicates and removes missing ids", () => {
  const cleaned = cleanChunks([
    { chunk_id: "c1", file_url: "u1" },
    { chunk_id: "c1", file_url: "u1" },
    { chunk_id: "", file_url: "u2" },
  ]);
  assert.equal(cleaned.length, 1);
  assert.equal(cleaned[0].id, "c1");
});

test("buildContext and extractChunkIds", () => {
  const chunks = [{ id: "c1", u: "u1" }, { id: "c2", u: "u2" }];
  const context = buildContext(chunks);
  assert.ok(context.includes("Source 1"));
  assert.deepEqual(extractChunkIds(chunks), ["c1", "c2"]);
});

test("buildContext supports metadata options", () => {
  const ctx = buildContext([
    { kind: "metadata", asked_info: ["granth", "link"], options: [{ g: "Samaysaar", link: "https://x" }] },
  ]);
  assert.ok(ctx.includes("metadata"));
  assert.ok(ctx.includes("Samaysaar"));
});

test("buildMultiLangContext includes both sections", () => {
  const hindiChunks = [{ id: "h1", t: "hindi text" }];
  const gujaratiChunks = [{ id: "g1", t: "gujarati text" }];
  const output = buildMultiLangContext(hindiChunks, gujaratiChunks);
  assert.ok(output.includes("### Hindi Passages"));
  assert.ok(output.includes("### Gujarati Passages"));
});

test("buildMultiLangContext omits gujarati section when empty", () => {
  const hindiChunks = [{ id: "h1", t: "hindi text" }];
  const output = buildMultiLangContext(hindiChunks, []);
  assert.equal(output.includes("### Gujarati Passages"), false);
  assert.ok(output.length > 0);
});

test("buildMultiLangContext omits hindi section when empty", () => {
  const gujaratiChunks = [{ id: "g1", t: "gujarati text" }];
  const output = buildMultiLangContext([], gujaratiChunks);
  assert.equal(output.includes("### Hindi Passages"), false);
  assert.ok(output.includes("### Gujarati Passages"));
});

test("buildMultiLangContext returns empty string when both empty", () => {
  const output = buildMultiLangContext([], []);
  assert.equal(output, "");
});

// --- buildGuidedContext ---

test("buildGuidedContext returns empty string for null / empty input", () => {
  assert.equal(buildGuidedContext(null), "");
  assert.equal(buildGuidedContext([]), "");
  assert.equal(buildGuidedContext(undefined), "");
});

test("buildGuidedContext returns empty string when all result sets are empty", () => {
  const guided = [{ guided_filter: { shastra: "samaysaar", gatha: 1, page: null, teeka: null }, chunks: [] }];
  assert.equal(buildGuidedContext(guided), "");
});

test("buildGuidedContext produces labelled section with filter and chunks", () => {
  const guided = [
    {
      guided_filter: { shastra: "samaysaar", gatha: 6, page: null, teeka: null },
      chunks: [{ id: "c1", t: "some text" }],
    },
  ];
  const output = buildGuidedContext(guided);
  assert.ok(output.includes("### Guided Passages (kb-suggested filters)"));
  assert.ok(output.includes("filter: shastra=samaysaar, gatha=6"));
  assert.ok(output.includes("Source 1"));
});

test("buildGuidedContext renders multiple filter sets", () => {
  const guided = [
    {
      guided_filter: { shastra: "s1", gatha: 1, page: null, teeka: null },
      chunks: [{ id: "c1", t: "text1" }],
    },
    {
      guided_filter: { shastra: "s2", gatha: null, page: 5, teeka: null },
      chunks: [{ id: "c2", t: "text2" }],
    },
  ];
  const output = buildGuidedContext(guided);
  assert.ok(output.includes("shastra=s1, gatha=1"));
  assert.ok(output.includes("shastra=s2, page=5"));
});

test("buildGuidedContext omits null filter fields from label", () => {
  const guided = [
    {
      guided_filter: { shastra: "samaysaar", gatha: null, page: null, teeka: null },
      chunks: [{ id: "c1", t: "t" }],
    },
  ];
  const output = buildGuidedContext(guided);
  assert.ok(output.includes("shastra=samaysaar"));
  assert.ok(!output.includes("gatha="));
  assert.ok(!output.includes("page="));
});

test("buildGuidedContext handles null guided_filter object gracefully", () => {
  const guided = [{ guided_filter: null, chunks: [{ id: "c1", t: "t" }] }];
  const output = buildGuidedContext(guided);
  assert.ok(output.includes("(unknown)"));
});
