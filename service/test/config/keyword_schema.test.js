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

// Phase 1 GraphRAG: Jain classification fields
test("schema includes jain_keywords and normal_keywords as nullable arrays", () => {
  const jain = KEYWORD_EXTRACTION_SCHEMA.properties.jain_keywords;
  const normal = KEYWORD_EXTRACTION_SCHEMA.properties.normal_keywords;
  assert.ok(Array.isArray(jain.type) ? jain.type.includes("array") : jain.type === "array");
  assert.ok(Array.isArray(normal.type) ? normal.type.includes("array") : normal.type === "array");
  assert.ok(KEYWORD_EXTRACTION_SCHEMA.required.includes("jain_keywords"));
  assert.ok(KEYWORD_EXTRACTION_SCHEMA.required.includes("normal_keywords"));
});

test("schema includes kb_subworkflows with allowed names enum", () => {
  const sw = KEYWORD_EXTRACTION_SCHEMA.properties.kb_subworkflows;
  assert.ok(Array.isArray(sw.type) ? sw.type.includes("array") : sw.type === "array");
  const nameEnum = sw.items.properties.name.enum;
  assert.ok(nameEnum.includes("direct_retrieval"));
  assert.ok(nameEnum.includes("search_shastra_for_topics"));
  assert.ok(nameEnum.includes("search_topic_in_shastra"));
  assert.ok(KEYWORD_EXTRACTION_SCHEMA.required.includes("kb_subworkflows"));
});

test("schema includes kb_entities with shastra_hints and author_hints", () => {
  const ent = KEYWORD_EXTRACTION_SCHEMA.properties.kb_entities;
  assert.ok(Array.isArray(ent.type) ? ent.type.includes("object") : ent.type === "object");
  assert.ok(ent.properties.shastra_hints);
  assert.ok(ent.properties.author_hints);
  assert.ok(KEYWORD_EXTRACTION_SCHEMA.required.includes("kb_entities"));
});

test("guj search schema includes jain_keywords, normal_keywords, kb_subworkflows, kb_entities", () => {
  assert.ok(KEYWORD_EXTRACTION_SCHEMA_GUJ_SEARCH.required.includes("jain_keywords"));
  assert.ok(KEYWORD_EXTRACTION_SCHEMA_GUJ_SEARCH.required.includes("normal_keywords"));
  assert.ok(KEYWORD_EXTRACTION_SCHEMA_GUJ_SEARCH.required.includes("kb_subworkflows"));
  assert.ok(KEYWORD_EXTRACTION_SCHEMA_GUJ_SEARCH.required.includes("kb_entities"));
});

test("kb_subworkflows item schema has all fields required and additionalProperties false", () => {
  const item = KEYWORD_EXTRACTION_SCHEMA.properties.kb_subworkflows.items;
  assert.equal(item.additionalProperties, false);
  assert.ok(item.required.includes("name"));
  assert.ok(item.required.includes("shastra"));
  assert.ok(item.required.includes("gatha_number"));
  assert.ok(item.required.includes("want"));
  assert.ok(item.required.includes("topic"));
});
