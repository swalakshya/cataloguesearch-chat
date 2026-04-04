import { test } from "node:test";
import assert from "node:assert/strict";

import { trimConversationHistoryForFollowup } from "../../src/sessions/conversation_history.js";

test("trimConversationHistoryForFollowup clears history when not followup", () => {
  const history = [{ id: "set_1" }, { id: "set_2" }];
  const trimmed = trimConversationHistoryForFollowup(history, false);
  assert.deepEqual(trimmed, []);
  assert.deepEqual(history, [{ id: "set_1" }, { id: "set_2" }]);
});

test("trimConversationHistoryForFollowup keeps history when followup", () => {
  const history = [{ id: "set_1" }];
  const trimmed = trimConversationHistoryForFollowup(history, true);
  assert.equal(trimmed, history);
  assert.deepEqual(trimmed, [{ id: "set_1" }]);
});

test("trimConversationHistoryForFollowup handles missing history", () => {
  assert.deepEqual(trimConversationHistoryForFollowup(undefined, true), []);
  assert.deepEqual(trimConversationHistoryForFollowup(undefined, false), []);
});
