import { test } from "node:test";
import assert from "node:assert/strict";

import { stripCitations, extractReferences } from "../../src/utils/answer.js";

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
