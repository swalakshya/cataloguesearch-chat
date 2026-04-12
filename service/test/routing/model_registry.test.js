import { test } from "node:test";
import assert from "node:assert/strict";
import { getOrderedModels } from "../../src/routing/model_registry.js";

test("getOrderedModels sorts by priority asc", () => {
  const models = getOrderedModels();
  assert.deepEqual(models.map((m) => m.id), [
    "gemini-2.5-flash",
    "gemini-3-flash-preview",
    "gpt-4o",
  ]);
});
