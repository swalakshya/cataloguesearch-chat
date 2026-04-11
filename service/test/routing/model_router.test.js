import { test } from "node:test";
import assert from "node:assert/strict";
import { ModelRouter } from "../../src/routing/model_router.js";
import { ModelAvailabilityTracker } from "../../src/routing/model_availability.js";

const models = [
  { id: "m1", provider: "gemini", priority: 1 },
  { id: "m2", provider: "gemini", priority: 2 },
];

test("router tries available models in priority order", async () => {
  const tracker = new ModelAvailabilityTracker({ windowMs: 60_000, failureRateThreshold: 0.5, minSamples: 2, now: () => 0 });
  const router = new ModelRouter({ models, tracker });

  const attempts = [];
  const result = await router.route(async (model) => {
    attempts.push(model.id);
    if (model.id === "m1") throw Object.assign(new Error("Service Unavailable"), { status: 503 });
    return "ok";
  });

  assert.equal(result, "ok");
  assert.deepEqual(attempts, ["m1", "m2"]);
});
