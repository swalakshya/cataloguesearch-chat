import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyProviderError } from "../../src/routing/error_classifier.js";

function err(message, status) {
  const e = new Error(message);
  if (status) e.status = status;
  return e;
}

test("classifies 503 as server-side", () => {
  assert.equal(classifyProviderError(err("OpenAI request failed (503)", 503)).kind, "server");
});

test("classifies UNAVAILABLE as server-side", () => {
  assert.equal(classifyProviderError(err("UNAVAILABLE: model is overloaded")).kind, "server");
});

test("classifies 401 as client-side", () => {
  assert.equal(classifyProviderError(err("Unauthorized", 401)).kind, "client");
});
