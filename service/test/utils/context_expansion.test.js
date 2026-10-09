import { test } from "node:test";
import assert from "node:assert/strict";
import { expandChunkContexts, cleanChunks } from "../../src/utils/chunk.js";
import { buildHashedChunks } from "../../src/utils/chunk_hash.js";
import { buildChunkCitationMap, expandChunkCitations } from "../../src/utils/answer.js";

test("neighbour excerpts become independently citable sources with their own pages", () => {
  const before = { chunk_id: "before", text_content: "earlier explanation", page_number: 1, pdf_page_number: 5, granth: "Book", file_url: "before.pdf" };
  const central = { chunk_id: "central", text_content: "central passage", page_number: 2, _lang: "gu",
    rerank_context: { previous: before, next: { chunk_id: "after", text_content: "later explanation", page_number: 3 } } };
  const expanded = expandChunkContexts([central]);
  assert.deepEqual(expanded.map(c => c.chunk_id), ["central", "before", "after"]);
  assert.ok(expanded.every(c => c._lang === "gu"));
  const session = { chunkIdMap: {}, chunkIdReverseMap: {}, chunkIdCounter: 0 };
  const hashed = buildHashedChunks(cleanChunks(expanded), session);
  const metadata = Object.fromEntries(expanded.map(c => [c.chunk_id, c]));
  const map = buildChunkCitationMap(hashed, session.chunkIdMap, metadata);
  const answer = expandChunkCitations("{c2}", map);
  assert.match(answer, /page="1"/);
  assert.match(answer, /file_url="before.pdf"/);
  assert.match(answer, /earlier explanation/);
});

test("direct results take priority over overlapping cropped neighbours", () => {
  const direct = { chunk_id: "b", text_content: "complete paragraph", page_number: 2 };
  const a = { chunk_id: "a", text_content: "a", rerank_context: { next: { ...direct, text_content: "cropped" } } };
  const expanded = expandChunkContexts([a, direct]);
  assert.equal(expanded.filter(c => c.chunk_id === "b").length, 1);
  assert.equal(expanded.find(c => c.chunk_id === "b").text_content, "complete paragraph");
});

test("unexpanded requests preserve existing inputs and skip absent context", () => {
  const chunks = [{ chunk_id: "a", text_content: "a" }];
  assert.deepEqual(expandChunkContexts(chunks), chunks);
  assert.deepEqual(expandChunkContexts(null), []);
});

test("flag-off inputs preserve duplicate order and object identity", () => {
  const chunks = [{ chunk_id: "a", text_content: "first" }, { chunk_id: "a", text_content: "second" }];
  assert.strictEqual(expandChunkContexts(chunks), chunks);
  assert.equal(cleanChunks(expandChunkContexts(chunks))[0].t, "first");
});

test("context expansion preserves bilingual versions of a shared paragraph ID", () => {
  const chunks = [
    { chunk_id: "shared", _lang: "hi", text_content: "Hindi", rerank_context: {
      previous: { chunk_id: "before", text_content: "Hindi before" } } },
    { chunk_id: "shared", _lang: "gu", text_content: "Gujarati", rerank_context: {
      previous: { chunk_id: "before", text_content: "Gujarati before" } } },
  ];
  const expanded = expandChunkContexts(chunks);
  assert.deepEqual(expanded.map(c => [c.chunk_id, c._lang]), [["shared", "hi"], ["before", "hi"], ["shared", "gu"], ["before", "gu"]]);
});
