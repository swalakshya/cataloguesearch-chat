import { test } from "node:test";
import assert from "node:assert/strict";

import { buildGreetingAnswer } from "../../src/utils/greeting.js";

test("buildGreetingAnswer returns english by default", () => {
  const text = buildGreetingAnswer({ script: "latin", email: "" });
  assert.ok(text.includes("*Jai Jinendra!*"));
  assert.ok(text.includes("projectjinam@gmail.com"));
});

test("buildGreetingAnswer returns devanagari when script is devanagari", () => {
  const text = buildGreetingAnswer({ script: "devanagari", email: "x@y.com" });
  assert.ok(text.startsWith("*जय जिनेन्द्र!*"));
  assert.ok(text.includes("x@y.com"));
});
