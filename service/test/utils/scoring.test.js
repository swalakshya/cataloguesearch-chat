import { test } from "node:test";
import assert from "node:assert/strict";

import { buildScoredChunks } from "../../src/utils/scoring.js";

test("buildScoredChunks keeps only allowed hashed ids", () => {
  const scoring = [
    { chunk_id: "c1", score: 10 },
    { chunk_id: "real-1", score: 99 },
    { chunk_id: "c2", score: 5 },
  ];
  const allowed = ["c1", "c2"];
  const scored = buildScoredChunks(scoring, allowed);
  assert.deepEqual(scored.map((s) => s.chunk_id), ["c1", "c2"]);
});
