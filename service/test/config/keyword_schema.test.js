import { test } from "node:test";
import assert from "node:assert/strict";

import { KEYWORD_EXTRACTION_SCHEMA, KEYWORD_EXTRACTION_SCHEMA_GUJ_SEARCH } from "../../src/config/keyword_schema.js";

test("keyword schema includes required fields and followup keyword objects", () => {
  assert.ok(KEYWORD_EXTRACTION_SCHEMA.required.includes("language"));
  assert.ok(KEYWORD_EXTRACTION_SCHEMA.required.includes("workflow"));
  assert.ok(KEYWORD_EXTRACTION_SCHEMA.required.includes("is_followup"));

  const followup = KEYWORD_EXTRACTION_SCHEMA.properties.followup_keywords;
  assert.ok(Array.isArray(followup.type) ? followup.type.includes("array") : followup.type === "array");
  assert.equal(followup.items.type, "object");
  assert.ok(followup.items.required.includes("id"));
  assert.ok(followup.items.required.includes("keywords"));
});

test("keyword schema includes greeting workflow", () => {
  assert.ok(KEYWORD_EXTRACTION_SCHEMA.properties.workflow.enum.includes("greeting_message_v1"));
});

test("keyword schema accepts metadata_question_v1 with asked_info", () => {
  const askedInfo = KEYWORD_EXTRACTION_SCHEMA.properties.asked_info;
  assert.ok(Array.isArray(askedInfo.type) ? askedInfo.type.includes("array") : askedInfo.type === "array");
  assert.equal(askedInfo.items.type, "string");
  assert.deepEqual(askedInfo.items.enum, ["granth", "anuyog", "author", "link"]);
  assert.ok(KEYWORD_EXTRACTION_SCHEMA.properties.workflow.enum.includes("metadata_question_v1"));
});

test("guj search schema includes keywords_guj at top level", () => {
  assert.ok(KEYWORD_EXTRACTION_SCHEMA_GUJ_SEARCH.required.includes("keywords_guj"));
  const kwGuj = KEYWORD_EXTRACTION_SCHEMA_GUJ_SEARCH.properties.keywords_guj;
  assert.ok(Array.isArray(kwGuj.type) ? kwGuj.type.includes("array") : kwGuj.type === "array");
});

test("guj search schema requires keywords_guj in queries items", () => {
  const queries = KEYWORD_EXTRACTION_SCHEMA_GUJ_SEARCH.properties.queries;
  const items = queries.items;
  assert.ok(items.required.includes("keywords_guj"));
  const kwGuj = items.properties.keywords_guj;
  assert.ok(Array.isArray(kwGuj.type) ? kwGuj.type.includes("array") : kwGuj.type === "array");
});

test("guj search schema requires keywords_guj in main_query", () => {
  const mainQuery = KEYWORD_EXTRACTION_SCHEMA_GUJ_SEARCH.properties.main_query;
  assert.ok(mainQuery.required.includes("keywords_guj"));
  const kwGuj = mainQuery.properties.keywords_guj;
  assert.ok(Array.isArray(kwGuj.type) ? kwGuj.type.includes("array") : kwGuj.type === "array");
});

test("guj search schema requires keywords_guj in sub_queries items", () => {
  const subQueries = KEYWORD_EXTRACTION_SCHEMA_GUJ_SEARCH.properties.sub_queries;
  const items = subQueries.items;
  assert.ok(items.required.includes("keywords_guj"));
  const kwGuj = items.properties.keywords_guj;
  assert.ok(Array.isArray(kwGuj.type) ? kwGuj.type.includes("array") : kwGuj.type === "array");
});

test("guj search schema requires keywords_guj in followup_keywords items", () => {
  const followupKeywords = KEYWORD_EXTRACTION_SCHEMA_GUJ_SEARCH.properties.followup_keywords;
  const items = followupKeywords.items;
  assert.ok(items.required.includes("keywords_guj"));
  const kwGuj = items.properties.keywords_guj;
  assert.ok(Array.isArray(kwGuj.type) ? kwGuj.type.includes("array") : kwGuj.type === "array");
});
