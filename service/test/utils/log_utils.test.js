import { test } from "node:test";
import assert from "node:assert/strict";

import { maskKey, summarize } from "../../src/utils/log.js";

test("maskKey hides most characters", () => {
  assert.equal(maskKey("abcdef"), "***");
  assert.equal(maskKey("abcdefghijk"), "abcd...jk");
});

test("summarize handles arrays and circular data", () => {
  const value = { a: [1, 2, 3] };
  value.self = value;
  const result = summarize(value, 200);
  assert.ok(result.includes("[Circular]"));
});
