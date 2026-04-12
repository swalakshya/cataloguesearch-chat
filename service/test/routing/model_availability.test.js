import { test } from "node:test";
import assert from "node:assert/strict";
import { ModelAvailabilityTracker } from "../../src/routing/model_availability.js";

function at(ms) {
  return 1_000_000 + ms;
}

test("model is available when sample count below min", () => {
  const tracker = new ModelAvailabilityTracker({ windowMs: 60_000, failureRateThreshold: 0.1, minSamples: 3, now: () => at(0) });
  tracker.record("m1", true);
  tracker.record("m1", true);
  assert.equal(tracker.isAvailable("m1"), true);
});

test("model becomes unavailable when failure rate exceeds threshold", () => {
  const tracker = new ModelAvailabilityTracker({ windowMs: 60_000, failureRateThreshold: 0.5, minSamples: 4, now: () => at(0) });
  tracker.record("m1", true);
  tracker.record("m1", true);
  tracker.record("m1", true);
  tracker.record("m1", false);
  assert.equal(tracker.isAvailable("m1"), false);
});

test("old events outside window are pruned", () => {
  let t = 0;
  const tracker = new ModelAvailabilityTracker({ windowMs: 1_000, failureRateThreshold: 0.5, minSamples: 2, now: () => at(t) });
  tracker.record("m1", true); // t=0
  t = 2_000;
  tracker.record("m1", false); // only one in window
  assert.equal(tracker.isAvailable("m1"), true);
});

test("hardDisable makes model unavailable until window elapses", () => {
  let t = 0;
  const tracker = new ModelAvailabilityTracker({ windowMs: 1_000, failureRateThreshold: 0.5, minSamples: 2, now: () => at(t) });
  tracker.hardDisable("m1");
  assert.equal(tracker.isAvailable("m1"), false);
  t = 2_000;
  assert.equal(tracker.isAvailable("m1"), true);
});
