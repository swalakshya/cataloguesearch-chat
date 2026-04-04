import { test } from "node:test";
import assert from "node:assert/strict";

import { cleanChunk, cleanChunks, buildContext, extractChunkIds } from "../../src/orchestrator/chunk_utils.js";

test("cleanChunk normalizes fields", () => {
  const chunk = cleanChunk({ chunk_id: "c1", file_url: "u", page_number: 1, text_content: "t" });
  assert.equal(chunk.id, "c1");
  assert.equal(chunk.u, "u");
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
