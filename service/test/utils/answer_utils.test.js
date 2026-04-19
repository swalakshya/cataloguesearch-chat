import { test } from "node:test";
import assert from "node:assert/strict";

import {
  appendReferencesSection,
  buildStructuredReferencesFromMetadata,
  buildChunkCitationMap,
  expandChunkCitations,
  extractFollowUpQuestionsFromAnswer,
  sanitizeFollowUpQuestions,
  stripCitations,
  extractReferences,
  normalizeAnswerTextForParsing,
  cleanAnswerText,
  normalizeReferencesInAnswer,
} from "../../src/utils/answer.js";

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

test("extractReferences appends /N to file_url when missing", () => {
  const text = [
    "Answer line",
    "References",
    "1. Samaysaar, Granth, Page 12 http://example.com/file.pdf#page=12",
    "2. Pravachansaar, Granth, Page 7 http://example.com/other.pdf/7",
  ].join("\n");

  const { references } = extractReferences(text);
  assert.equal(references[0], "Samaysaar, Granth, Page 12 http://example.com/file.pdf#page=12/12");
  assert.equal(references[1], "Pravachansaar, Granth, Page 7 http://example.com/other.pdf/7");
});

test("extractReferences appends /N when page is written as पृष्ठ 12", () => {
  const text = [
    "Answer line",
    "References",
    "1. Samaysaar, Granth, पृष्ठ 12 http://example.com/file.pdf",
  ].join("\n");

  const { references } = extractReferences(text);
  assert.equal(references[0], "Samaysaar, Granth, पृष्ठ 12 http://example.com/file.pdf/12");
});

test("normalizeReferencesInAnswer appends /N only in References section", () => {
  const text = [
    "Answer line",
    "References",
    "1. Samaysaar, Granth, Page 12 http://example.com/file.pdf#page=12",
    "2. Already ok http://example.com/x/7",
    "Other section",
    "Line with http://example.com/nochange",
  ].join("\n");

  const normalized = normalizeReferencesInAnswer(text);
  const lines = normalized.split("\n");
  assert.equal(lines[2], "1. Samaysaar, Granth, Page 12 http://example.com/file.pdf#page=12/12");
  assert.equal(lines[3], "2. Already ok http://example.com/x/7");
  assert.equal(lines[5], "Line with http://example.com/nochange");
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

test("buildStructuredReferencesFromMetadata formats Pravachan references from metadata", () => {
  const { references, citations } = buildStructuredReferencesFromMetadata({
    scoredChunks: [{ chunk_id: "c1", score: 100 }],
    maxReferences: 2,
    hashToRealId: { c1: "real-1" },
    metadataByRealId: {
      "real-1": {
        chunk_id: "real-1",
        category: "Pravachan",
        granth: "Pravachansaar",
        pravachankar: "पूज्य गुरुदेव श्री कानजी स्वामी",
        pravachan_number: "265",
        series: "1979 Series",
        volume: 11,
        shlok: "271-272",
        page_number: 254,
        date: "1979-09-08",
        file_url: "https://example.com/p",
      },
    },
    language: "hi",
  });

  assert.equal(references.length, 1);
  assert.equal(
    references[0],
    'पूज्य गुरुदेव श्री कानजी स्वामी द्वारा "Pravachansaar प्रवचन", क्रमांक 265, Volume 11, श्लोक 271-272, पृष्ठ 254, दिनांक 08-09-1979, https://example.com/p/254'
  );
  assert.equal(citations[0].category, "Pravachan");
  assert.equal(citations[0].pravachankar, "पूज्य गुरुदेव श्री कानजी स्वामी");
  assert.equal(citations[0].date, "08-09-1979");
  assert.equal(citations[0].series, "1979 Series");
});

test("buildStructuredReferencesFromMetadata formats Granth references from metadata", () => {
  const { references, citations } = buildStructuredReferencesFromMetadata({
    scoredChunks: [{ chunk_id: "c1", score: 90 }],
    maxReferences: 1,
    hashToRealId: { c1: "real-1" },
    metadataByRealId: {
      "real-1": {
        chunk_id: "real-1",
        category: "Granth",
        granth: "Samaysaar",
        gatha: "12",
        page_number: 145,
        file_url: "https://example.com/g",
      },
    },
    language: "hi",
  });

  assert.equal(references[0], "Samaysaar, गाथा 12, पृष्ठ 145, https://example.com/g/145");
  assert.equal(citations[0].gatha, "12");
});

test("buildStructuredReferencesFromMetadata respects zero parsed reference count", () => {
  const { references, citations } = buildStructuredReferencesFromMetadata({
    scoredChunks: [{ chunk_id: "c1", score: 90 }],
    maxReferences: 0,
    hashToRealId: { c1: "real-1" },
    metadataByRealId: {
      "real-1": {
        chunk_id: "real-1",
        category: "Pravachan",
        granth: "Pravachansaar",
        page_number: 145,
        file_url: "https://example.com/p",
      },
    },
    language: "hi",
  });

  assert.deepEqual(references, []);
  assert.deepEqual(citations, []);
});

test("buildStructuredReferencesFromMetadata limits output to maxReferences count", () => {
  const chunks = [
    { chunk_id: "c1", score: 90 },
    { chunk_id: "c2", score: 80 },
    { chunk_id: "c3", score: 70 },
  ];
  const hashToRealId = { c1: "r1", c2: "r2", c3: "r3" };
  const metadataByRealId = {
    "r1": { chunk_id: "r1", category: "Granth", granth: "Samaysaar", page_number: 1, file_url: "https://example.com/a" },
    "r2": { chunk_id: "r2", category: "Granth", granth: "Pravachansaar", page_number: 2, file_url: "https://example.com/b" },
    "r3": { chunk_id: "r3", category: "Granth", granth: "Niyamsaar", page_number: 3, file_url: "https://example.com/c" },
  };

  const { references: refs2 } = buildStructuredReferencesFromMetadata({
    scoredChunks: chunks, maxReferences: 2, hashToRealId, metadataByRealId,
  });
  assert.equal(refs2.length, 2);

  const { references: refs5 } = buildStructuredReferencesFromMetadata({
    scoredChunks: chunks, maxReferences: 5, hashToRealId, metadataByRealId,
  });
  assert.equal(refs5.length, 3); // only 3 chunks available
});

test("buildStructuredReferencesFromMetadata returns top-scored chunks first", () => {
  const chunks = [
    { chunk_id: "c1", score: 50 },
    { chunk_id: "c2", score: 95 },
    { chunk_id: "c3", score: 70 },
  ];
  const hashToRealId = { c1: "r1", c2: "r2", c3: "r3" };
  const metadataByRealId = {
    "r1": { chunk_id: "r1", category: "Granth", granth: "A", page_number: 1, file_url: "https://example.com/a" },
    "r2": { chunk_id: "r2", category: "Granth", granth: "B", page_number: 2, file_url: "https://example.com/b" },
    "r3": { chunk_id: "r3", category: "Granth", granth: "C", page_number: 3, file_url: "https://example.com/c" },
  };

  const { citations } = buildStructuredReferencesFromMetadata({
    scoredChunks: chunks, maxReferences: 3, hashToRealId, metadataByRealId,
  });
  // scoredChunks is pre-sorted by score desc (buildScoredChunks does that), but here we pass unsorted
  // The function iterates scoredChunks in order, so c1(50) first, then c2(95), then c3(70)
  assert.equal(citations[0].granth, "A");
  assert.equal(citations[1].granth, "B");
  assert.equal(citations[2].granth, "C");
});

test("appendReferencesSection rebuilds Hindi references section", () => {
  const output = appendReferencesSection("उत्तर", ["पहला संदर्भ", "दूसरा संदर्भ"], "hi");
  assert.equal(output, "उत्तर\n\nसंदर्भ\n1. पहला संदर्भ\n2. दूसरा संदर्भ");
});

test("extractFollowUpQuestionsFromAnswer extracts English follow-ups", () => {
  const text = [
    "Main answer text.",
    "_If you want I can answer this in detail or I can also answer -_",
    "- What is karma?",
    "- What is moksha?",
  ].join("\n");

  const { answer, followUpQuestions } = extractFollowUpQuestionsFromAnswer(text);
  assert.equal(answer, "Main answer text.");
  assert.deepEqual(followUpQuestions, ["What is karma?", "What is moksha?"]);
});

test("extractFollowUpQuestionsFromAnswer extracts Hindi follow-ups", () => {
  const text = [
    "मुख्य उत्तर।",
    "_अगर आप चाहें तो मैं और विस्तार से उत्तर दे सकता हूँ अथवा मैं इन सवालों के जवाब भी दे सकता हूँ_",
    "- कर्म क्या है?",
    "- मोक्ष क्या है?",
  ].join("\n");

  const { answer, followUpQuestions } = extractFollowUpQuestionsFromAnswer(text);
  assert.equal(answer, "मुख्य उत्तर।");
  assert.deepEqual(followUpQuestions, ["कर्म क्या है?", "मोक्ष क्या है?"]);
});

test("extractFollowUpQuestionsFromAnswer returns original answer when no marker found", () => {
  const text = "Answer with no follow-ups.";
  const { answer, followUpQuestions } = extractFollowUpQuestionsFromAnswer(text);
  assert.equal(answer, text);
  assert.deepEqual(followUpQuestions, []);
});

test("extractFollowUpQuestionsFromAnswer strips trailing blanks before follow-up section", () => {
  const text = [
    "Main answer.",
    "",
    "_If you want I can answer this in detail or I can also answer -_",
    "- Question 1?",
  ].join("\n");

  const { answer, followUpQuestions } = extractFollowUpQuestionsFromAnswer(text);
  assert.equal(answer, "Main answer.");
  assert.deepEqual(followUpQuestions, ["Question 1?"]);
});

test("extractFollowUpQuestionsFromAnswer preserves text after follow-up section", () => {
  const text = [
    "Main answer.",
    "_If you want I can answer this in detail or I can also answer -_",
    "- Question 1?",
    "",
    "References",
    "1. Samaysaar http://example.com",
  ].join("\n");

  const { answer, followUpQuestions } = extractFollowUpQuestionsFromAnswer(text);
  assert.ok(answer.includes("References"));
  assert.deepEqual(followUpQuestions, ["Question 1?"]);
});

test("sanitizeFollowUpQuestions trims, dedupes and caps items", () => {
  const output = sanitizeFollowUpQuestions([" q1 ", "", "q2", "q1", "q3", "q4"]);
  assert.deepEqual(output, ["q1", "q2", "q3"]);
});

// buildChunkCitationMap
test("buildChunkCitationMap builds map from hashed chunks and metadata", () => {
  const chunks = [{ id: "c1", t: "chunk text", g: "Samaysaar", p: 12 }];
  const hashToRealId = { c1: "r1" };
  const metadataByRealId = { r1: { category: "Granth", granth: "Samaysaar" } };
  const map = buildChunkCitationMap(chunks, hashToRealId, metadataByRealId);
  assert.equal(map.c1.text, "chunk text");
  assert.equal(map.c1.source, "Samaysaar");
  assert.equal(map.c1.pageNumber, 12);
});

test("buildChunkCitationMap appends Pravachan to source for Pravachan category (English)", () => {
  const chunks = [{ id: "c1", t: "pravachan text", g: "Pravachansaar", p: 5 }];
  const hashToRealId = { c1: "r1" };
  const metadataByRealId = { r1: { category: "Pravachan" } };
  const map = buildChunkCitationMap(chunks, hashToRealId, metadataByRealId, "en");
  assert.equal(map.c1.source, "Pravachansaar Pravachan");
});

test("buildChunkCitationMap appends प्रवचन to source for Pravachan category when Hindi", () => {
  const chunks = [{ id: "c1", t: "प्रवचन टेक्स्ट", g: "प्रवचनसार", p: 5 }];
  const hashToRealId = { c1: "r1" };
  const metadataByRealId = { r1: { category: "Pravachan" } };
  const map = buildChunkCitationMap(chunks, hashToRealId, metadataByRealId, "hi");
  assert.equal(map.c1.source, "प्रवचनसार प्रवचन");
});

test("buildChunkCitationMap falls back to chunk granth when metadata missing", () => {
  const chunks = [{ id: "c1", t: "text", g: "Niyamsaar", p: 3 }];
  const map = buildChunkCitationMap(chunks, {}, {});
  assert.equal(map.c1.source, "Niyamsaar");
  assert.equal(map.c1.pageNumber, 3);
});

// expandChunkCitations
test("expandChunkCitations replaces {c1} with full chunk text and source", () => {
  const map = { c1: { text: "chunk text here", source: "Samaysaar", pageNumber: 12 } };
  const result = expandChunkCitations("Answer\n\n{c1}\n\nMore", map, "en");
  assert.ok(result.includes("> chunk text here (Samaysaar, Page 12)"));
  assert.ok(result.includes("Answer"));
  assert.ok(result.includes("More"));
});

test("expandChunkCitations uses Hindi page label for hi language", () => {
  const map = { c1: { text: "आत्मा नित्य है", source: "समयसार", pageNumber: 5 } };
  const result = expandChunkCitations("{c1}", map, "hi");
  assert.ok(result.includes("> आत्मा नित्य है (समयसार, पृष्ठ 5)"));
});

test("expandChunkCitations strips newlines from chunk text", () => {
  const map = { c1: { text: "line one\nline two\r\nline three", source: "Samaysaar", pageNumber: 1 } };
  const result = expandChunkCitations("{c1}", map, "en");
  assert.ok(result.includes("> line one line two line three (Samaysaar, Page 1)"));
  assert.ok(!result.includes("\n> line one\n"));
});

test("expandChunkCitations leaves unknown placeholders unchanged", () => {
  const result = expandChunkCitations("text {c99} end", {}, "en");
  assert.ok(result.includes("{c99}"));
});

test("expandChunkCitations handles missing page number", () => {
  const map = { c1: { text: "some text", source: "Granth", pageNumber: null } };
  const result = expandChunkCitations("{c1}", map, "en");
  assert.ok(result.includes("> some text (Granth)"));
});

test("expandChunkCitations handles missing source", () => {
  const map = { c1: { text: "some text", source: "", pageNumber: 7 } };
  const result = expandChunkCitations("{c1}", map, "en");
  assert.ok(result.includes("> some text (Page 7)"));
});
