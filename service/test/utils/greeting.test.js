import { test } from "node:test";
import assert from "node:assert/strict";

import { buildGreetingAnswer } from "../../src/utils/greeting.js";

test("buildGreetingAnswer returns english by default", () => {
  const { answer, followUpQuestions } = buildGreetingAnswer({ script: "latin", email: "" });
  assert.ok(answer.includes("*Jai Jinendra!*"));
  assert.ok(answer.includes("projectjinam@gmail.com"));
  assert.equal(followUpQuestions.length, 3);
});

test("buildGreetingAnswer returns devanagari when script is devanagari", () => {
  const { answer } = buildGreetingAnswer({ script: "devanagari", email: "x@y.com" });
  assert.ok(answer.startsWith("*जय जिनेन्द्र!*"));
  assert.ok(answer.includes("x@y.com"));
});

test("buildGreetingAnswer returns swalakshya greeting when app is swalakshya", () => {
  const { answer, followUpQuestions } = buildGreetingAnswer({ script: "latin", email: "", app: "swalakshya" });
  assert.ok(answer.includes("`Swalakshya AI`"));
  assert.ok(answer.includes("contact@swalakshya.me"));
  assert.equal(followUpQuestions.length, 3);
});

test("buildGreetingAnswer returns swalakshya devanagari greeting", () => {
  const { answer } = buildGreetingAnswer({ script: "devanagari", email: "", app: "swalakshya" });
  assert.ok(answer.startsWith("*जय जिनेन्द्र!*"));
  assert.ok(answer.includes("`Swalakshya AI`"));
  assert.ok(answer.includes("contact@swalakshya.me"));
});

test("buildGreetingAnswer falls back to jinam for an unknown app", () => {
  const { answer } = buildGreetingAnswer({ script: "latin", email: "", app: "unknown-app" });
  assert.ok(answer.includes("`JINAM Chatbot`"));
});

test("buildGreetingAnswer no longer embeds questions as blockquote lines in the answer", () => {
  const { answer } = buildGreetingAnswer({ script: "latin", email: "", app: "swalakshya" });
  assert.ok(!answer.includes("\n> "));
});
