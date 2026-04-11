import { test } from "node:test";
import assert from "node:assert/strict";

import { compactHistoryIfNeeded } from "../../src/orchestrator/history_summary.js";

test("compacts history when length reaches threshold and keeps top C chunks", async () => {
  const history = [
    {
      id: "set_1",
      question: "Q1",
      answer: "A1",
      chunk_scores: [
        { chunk_id: "c1", score: 12 },
        { chunk_id: "c2", score: 5 },
      ],
      chunk_ids: ["c1", "c2"],
    },
    {
      id: "set_2",
      question: "Q2",
      answer: "A2",
      chunk_scores: [{ chunk_id: "c3", score: 99 }],
      chunk_ids: ["c3"],
    },
    { id: "set_3", question: "Q3", answer: "A3", chunk_scores: [], chunk_ids: [] },
    {
      id: "set_4",
      question: "Q4",
      answer: "A4",
      chunk_scores: [
        { chunk_id: "c4", score: 20 },
        { chunk_id: "c5", score: 10 },
      ],
      chunk_ids: ["c4", "c5"],
    },
  ];

  const result = await compactHistoryIfNeeded({
    history,
    threshold: 4,
    topChunksPerSet: 1,
    summarize: async () => "summary-text",
  });

  assert.equal(result.didCompact, true);
  assert.equal(result.history.length, 1);
  assert.equal(result.history[0].question, "Conversation summary");
  assert.equal(result.history[0].answer, "summary-text");
  const chunkIds = result.history[0].chunk_ids.slice().sort();
  assert.deepEqual(chunkIds, ["c1", "c3", "c4"].sort());
  assert.ok(result.history[0].chunk_scores.every((c) => c.score === 100));
});
