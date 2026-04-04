import { test } from "node:test";
import assert from "node:assert/strict";

import { buildHashedChunks, getChunkHash, mapHashedIdsToReal } from "../src/utils/chunk_hash.js";

test("getChunkHashForTest produces stable hashes per session", () => {
  const session = { chunkIdMap: {}, chunkIdReverseMap: {}, chunkIdCounter: 0 };
  const h1 = getChunkHash(session, "real-1");
  const h2 = getChunkHash(session, "real-2");
  const h1b = getChunkHash(session, "real-1");
  assert.equal(h1, "c1");
  assert.equal(h2, "c2");
  assert.equal(h1b, "c1");
});

test("buildHashedChunksForTest replaces chunk_id with hash", () => {
  const session = { chunkIdMap: {}, chunkIdReverseMap: {}, chunkIdCounter: 0 };
  const chunks = [{ id: "real-1", t: "a" }];
  const hashed = buildHashedChunks(chunks, session);
  assert.equal(hashed[0].id, "c1");
});

test("mapHashedIdsToRealForTest maps hashes to real ids", () => {
  const session = { chunkIdMap: { c1: "real-1" }, chunkIdReverseMap: {}, chunkIdCounter: 1 };
  const mapped = mapHashedIdsToReal(["c1", "c2"], session);
  assert.deepEqual(mapped, ["real-1"]);
});
