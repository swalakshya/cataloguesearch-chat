import { test } from "node:test";
import assert from "node:assert/strict";

import { stripCitations, extractReferences, normalizeAnswerTextForParsing, cleanAnswerText } from "../../src/utils/answer.js";

test("stripCitations removes citation markers", () => {
  const text = "Hello citeturn1search0 world";
  assert.equal(stripCitations(text), "Hello  world");
});

test("extractReferences parses references section", () => {
  const text = [
    "Answer line",
    "",
    "References",
    "- Samaysaar (Granth) Page 12 http://example.com/file.pdf#page=12",
    "- Another (Books) Page 5 http://example.com/other.pdf#page=5",
  ].join("\n");

  const { answer, references, citations } = extractReferences(text);
  assert.equal(answer, "Answer line");
  assert.equal(references.length, 2);
  assert.equal(citations.length, 2);
  assert.equal(citations[0].granth, "Samaysaar");
  assert.equal(citations[0].category, "Granth");
  assert.equal(citations[0].page_number, 12);
});

test("extractReferences falls back to inline reference lines", () => {
  const text = [
    "Some answer text",
    "* **Pravachansaar**, Granth, Page 175, file_url: https://example.com/a.pdf#page=175",
    "* **Asht Pahud**, Granth, Page 109, file_url: https://example.com/b.pdf#page=109",
  ].join("\n");

  const { references } = extractReferences(text);
  assert.equal(references.length, 2);
  assert.equal(references[0].includes("**"), false);
});

test("normalizeReferenceLine strips granth and page_number labels", () => {
  const text = [
    "References",
    "1. granth: Samaysaar, page_number: 23, file_url: http://x",
  ].join("\n");

  const { references } = extractReferences(text);
  assert.equal(references[0].includes("granth:"), false);
  assert.equal(references[0].includes("page_number:"), false);
});

test("normalizeAnswerText converts escaped newlines", () => {
  const input = "Line1\\nLine2\\nReferences\\n- Ref http://x";
  const normalized = normalizeAnswerTextForParsing(input);
  assert.ok(normalized.includes("\n"));
  const { references } = extractReferences(normalized);
  assert.equal(references.length, 1);
});

test("normalizeAnswerText handles unicode separators", () => {
  const input = `Line1\u2028Line2\u2029References\u2028- Ref http://x`;
  const normalized = normalizeAnswerTextForParsing(input);
  const { references } = extractReferences(normalized);
  assert.equal(references.length, 1);
});

test("normalizeAnswerText preserves sub tags", () => {
  const input = "Text \\<sub\\>Ref\\</sub\\> and &lt;sub&gt;Ref2&lt;/sub&gt;";
  const normalized = normalizeAnswerTextForParsing(input);
  assert.ok(normalized.includes("<sub>Ref</sub>"));
  assert.ok(normalized.includes("<sub>Ref2</sub>"));
});

test("cleanAnswerText normalizes formatting and language hints", () => {
  const input =
    "Summary\\n**aatma** (c13)\\nReferences\\nIf you want I can answer this in detail or I can also answer\\n" +
    "This question cannot be answered at this time due to insufficient scriptural citations or multiple interpretations. To avoid incorrect guidance, we recommend consulting a knowledgeable acharya or scholar or please try rephrasing the question.";
  const cleaned = cleanAnswerText({ text: input, language: "hi", script: "devanagari" });
  assert.ok(cleaned.includes("सारांश"));
  assert.ok(cleaned.includes("*aatma*"));
  assert.equal(cleaned.includes("(c13)"), false);
  assert.ok(cleaned.includes("संदर्भ"));
  assert.ok(cleaned.includes("अगर आप चाहें तो मैं और विस्तार से उत्तर दे सकता हूँ"));
  assert.ok(cleaned.includes("अपर्याप्त ग्रंथ उद्धरणों के कारण या अनेक व्याख्याओं"));
});

test("cleanAnswerText removes parenthesized chunk-id lists", () => {
  const out1 = cleanAnswerText({ text: "Line with refs (c4, c5) and text" });
  const out2 = cleanAnswerText({ text: "Line with refs (c1, c6, c15) end" });
  assert.equal(out1, "Line with refs  and text");
  assert.equal(out2, "Line with refs  end");
});

test("cleanAnswerText keeps parentheses with non-chunk text", () => {
  const input = "Keep this (c4, other) intact";
  const output = cleanAnswerText({ text: input });
  assert.equal(output, input);
});
