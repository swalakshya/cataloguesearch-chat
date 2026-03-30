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
    id: "set_1",
    question: "Q1",
    answer: "A1",
    chunk_ids: ["c1", "c2"],
    chunk_scores: [{ chunk_id: "c1", score: 9 }],
  });
  assert.deepEqual(parsed[1], {
    id: "set_9",
    question: "Q2",
    answer: "A2",
    chunk_ids: [],
    chunk_scores: [],
  });
});
