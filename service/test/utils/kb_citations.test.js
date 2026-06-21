import { test } from "node:test";
import assert from "node:assert/strict";

import {
  buildKbCitationMap,
  formatKbReference,
  buildKbReferencesFromScoring,
} from "../../src/utils/kb_citations.js";

const DEF = { id: "KB-D-1", label: "आत्मा", source_url: "https://www.jainkosh.org/wiki/आत्मा" };
const TOP = { id: "KB-T-1", label: "लक्षण", source_url: "https://www.jainkosh.org/wiki/द्रव्य#3.1" };

// ─── buildKbCitationMap ──────────────────────────────────────────────────────

test("buildKbCitationMap: merges multiple lists keyed by id", () => {
  const map = buildKbCitationMap([DEF], [TOP]);
  assert.equal(map.size, 2);
  assert.deepEqual(map.get("KB-D-1"), DEF);
  assert.deepEqual(map.get("KB-T-1"), TOP);
});

test("buildKbCitationMap: drops entries without id or source_url", () => {
  const map = buildKbCitationMap([
    { id: "KB-D-1", label: "x", source_url: "" },
    { id: "", label: "y", source_url: "http://u" },
    DEF,
  ]);
  assert.equal(map.size, 1);
  assert.ok(map.has("KB-D-1"));
});

test("buildKbCitationMap: first occurrence of an id wins", () => {
  const map = buildKbCitationMap([DEF], [{ ...DEF, label: "OTHER" }]);
  assert.equal(map.get("KB-D-1").label, "आत्मा");
});

test("buildKbCitationMap: tolerates non-array inputs", () => {
  const map = buildKbCitationMap(null, undefined, [DEF]);
  assert.equal(map.size, 1);
});

// ─── formatKbReference ───────────────────────────────────────────────────────

test("formatKbReference: english label + url", () => {
  assert.equal(formatKbReference(DEF), "आत्मा (jainkosh) — https://www.jainkosh.org/wiki/आत्मा");
});

test("formatKbReference: hindi source label when language=hi", () => {
  assert.equal(formatKbReference(DEF, "hi"), "आत्मा (जैनकोष) — https://www.jainkosh.org/wiki/आत्मा");
});

test("formatKbReference: empty url → empty string", () => {
  assert.equal(formatKbReference({ label: "x", source_url: "" }), "");
});

// ─── buildKbReferencesFromScoring ────────────────────────────────────────────

test("buildKbReferencesFromScoring: maps cited KB ids to references + citations", () => {
  const map = buildKbCitationMap([DEF], [TOP]);
  const scoring = [
    { chunk_id: "KB-T-1", score: 90 },
    { chunk_id: "abc123", score: 80 }, // a chunk id — ignored
    { chunk_id: "KB-D-1", score: 70 },
  ];
  const { references, citations } = buildKbReferencesFromScoring({ scoring, kbCitationMap: map });
  // ordered by descending score: KB-T-1 (90) then KB-D-1 (70)
  assert.deepEqual(references, [
    "लक्षण (jainkosh) — https://www.jainkosh.org/wiki/द्रव्य#3.1",
    "आत्मा (jainkosh) — https://www.jainkosh.org/wiki/आत्मा",
  ]);
  assert.equal(citations.length, 2);
  assert.equal(citations[0].file_url, TOP.source_url);
  assert.equal(citations[0].category, "jainkosh");
});

test("buildKbReferencesFromScoring: ignores KB ids not present in the map", () => {
  const map = buildKbCitationMap([DEF]);
  const scoring = [{ chunk_id: "KB-T-9", score: 50 }];
  const out = buildKbReferencesFromScoring({ scoring, kbCitationMap: map });
  assert.deepEqual(out, { references: [], citations: [] });
});

test("buildKbReferencesFromScoring: dedupes a KB id keeping highest score", () => {
  const map = buildKbCitationMap([DEF], [TOP]);
  const scoring = [
    { chunk_id: "KB-D-1", score: 10 },
    { chunk_id: "KB-D-1", score: 95 },
    { chunk_id: "KB-T-1", score: 50 },
  ];
  const { references } = buildKbReferencesFromScoring({ scoring, kbCitationMap: map });
  // KB-D-1 (95) ranks above KB-T-1 (50)
  assert.equal(references.length, 2);
  assert.ok(references[0].startsWith("आत्मा"));
});

test("buildKbReferencesFromScoring: empty map → empty result", () => {
  const out = buildKbReferencesFromScoring({ scoring: [{ chunk_id: "KB-D-1", score: 1 }], kbCitationMap: new Map() });
  assert.deepEqual(out, { references: [], citations: [] });
});

test("buildKbReferencesFromScoring: non-array scoring → empty result", () => {
  const map = buildKbCitationMap([DEF]);
  assert.deepEqual(buildKbReferencesFromScoring({ scoring: null, kbCitationMap: map }), { references: [], citations: [] });
});

test("buildKbReferencesFromScoring: hindi references when language=hi", () => {
  const map = buildKbCitationMap([DEF]);
  const { references } = buildKbReferencesFromScoring({
    scoring: [{ chunk_id: "KB-D-1", score: 50 }],
    kbCitationMap: map,
    language: "hi",
  });
  assert.equal(references[0], "आत्मा (जैनकोष) — https://www.jainkosh.org/wiki/आत्मा");
});
