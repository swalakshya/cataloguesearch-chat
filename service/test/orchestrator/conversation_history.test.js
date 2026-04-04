import { test } from "node:test";
import assert from "node:assert/strict";

import { formatConversationHistory } from "../../src/orchestrator/conversation_history.js";

test("formatConversationHistory returns [] for empty input", () => {
  assert.equal(formatConversationHistory([]), "[]");
  assert.equal(formatConversationHistory(null), "[]");
});

test("formatConversationHistory normalizes entries and assigns ids", () => {
  const history = [
    {
      question: "  Q1 ",
      answer: " A1 ",
      chunk_ids: ["c1", "c2"],
      chunk_scores: [{ chunk_id: "c1", score: 9 }],
    },
    {
      id: "set_9",
      question: "Q2",
      answer: "A2",
    },
  ];

  const parsed = JSON.parse(formatConversationHistory(history));
  assert.equal(parsed.length, 2);
  assert.deepEqual(parsed[0], {
    i: "set_1",
    q: "Q1",
    a: "A1",
    s: [{ id: "c1", v: 9 }],
  });
  assert.deepEqual(parsed[1], {
    i: "set_9",
    q: "Q2",
    a: "A2",
    s: [],
  });
});

test("formatConversationHistory can omit chunk_scores", () => {
  const history = [
    {
      question: "Q1",
      answer: "A1",
      chunk_ids: ["c1"],
      chunk_scores: [{ chunk_id: "c1", score: 9 }],
    },
  ];

  const parsed = JSON.parse(formatConversationHistory(history, { includeChunkScores: false }));
  assert.deepEqual(parsed[0], {
    i: "set_1",
    q: "Q1",
    a: "A1",
  });
});
