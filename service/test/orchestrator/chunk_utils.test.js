import { test } from "node:test";
import assert from "node:assert/strict";

import { cleanChunk, cleanChunks, buildContext, extractChunkIds } from "../../src/orchestrator/chunk_utils.js";

test("cleanChunk normalizes fields", () => {
  const chunk = cleanChunk({ chunk_id: "c1", file_url: "u", page_number: 1, text_content: "t" });
  assert.equal(chunk.chunk_id, "c1");
  assert.equal(chunk.file_url, "u");
  assert.equal(chunk.text_content, "t");
});

test("cleanChunks de-duplicates and removes missing ids", () => {
  const cleaned = cleanChunks([
    { chunk_id: "c1", file_url: "u1" },
    { chunk_id: "c1", file_url: "u1" },
    { chunk_id: "", file_url: "u2" },
  ]);
  assert.equal(cleaned.length, 1);
  assert.equal(cleaned[0].chunk_id, "c1");
});

test("buildContext and extractChunkIds", () => {
  const chunks = [{ chunk_id: "c1", file_url: "u1" }, { chunk_id: "c2", file_url: "u2" }];
  const context = buildContext(chunks);
  assert.ok(context.includes("Source 1"));
  assert.deepEqual(extractChunkIds(chunks), ["c1", "c2"]);
});
