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

test("classifies native AbortError as server-side timeout", () => {
  const e = new DOMException("signal aborted", "AbortError");
  assert.equal(classifyProviderError(e).kind, "server");
  assert.equal(classifyProviderError(e).reason, "timeout");
});

test("classifies SDK-wrapped AbortError (message contains 'AbortError') as server-side timeout", () => {
  const result = classifyProviderError(err("exception AbortError: This operation was aborted"));
  assert.equal(result.kind, "server");
  assert.equal(result.reason, "timeout");
});

test("classifies SDK-wrapped AbortError (message contains 'operation was aborted') as server-side timeout", () => {
  const result = classifyProviderError(err("The operation was aborted"));
  assert.equal(result.kind, "server");
  assert.equal(result.reason, "timeout");
});

test("classifies 401 as client-side", () => {
  assert.equal(classifyProviderError(err("Unauthorized", 401)).kind, "client");
});
