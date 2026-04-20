import { getWorkflowConfig } from "../../config/workflow_config.js";
import { normalizeContentTypes } from "../../config/content_types.js";
import { log } from "../../utils/log.js";

export async function runFollowupQuestion({ externalApi, params, requestId, toolBudget, modelId }) {
  const results = [];
  const language = params.language || "hi";
  const filters = params.filters || {};
  const queries = Array.isArray(params.queries) ? params.queries : [];
  const mainQuery = params.main_query || {};
  const subQueries = Array.isArray(params.sub_queries) ? params.sub_queries : [];
  const config = getWorkflowConfig(modelId).followup;

  const searchPayload = (keywords) => ({
    query: buildQuery(keywords),
    language,
    content_type: normalizeContentTypes(filters.content_type),
    anuyog: filters.anuyog || null,
    granth: filters.granth || null,
    contributor: filters.contributor || null,
    page: config.page,
    page_size: config.page_size,
    rerank: config.rerank,
  });

  const followupKeywordSets = normalizeFollowupKeywordSets(params.followup_keywords);
  const userSearches = countUserSearches({ queries, mainQuery, subQueries, keywords: params.keywords });
  const extraSearches = followupKeywordSets.length;
  const expandCount = Array.isArray(params.expand_chunk_ids)
    ? Math.min(config.expand_limit, params.expand_chunk_ids.length)
    : 0;
  ensureBudget(toolBudget, userSearches + extraSearches + expandCount);

  if (queries.length) {
    for (const query of queries) {
      if (toolBudget.remaining() <= 0) break;
      toolBudget.consume();
      await safePush(results, () => externalApi.search(searchPayload(query.keywords), requestId), requestId);
    }
  } else if (subQueries.length || (mainQuery && Array.isArray(mainQuery.keywords))) {
    const mainKeywords = Array.isArray(mainQuery.keywords) ? mainQuery.keywords : [];
    if (!subQueries.length) {
      if (toolBudget.remaining() > 0) {
        toolBudget.consume();
        await safePush(results, () => externalApi.search(searchPayload(mainKeywords), requestId), requestId);
      }
    } else {
      for (const query of subQueries) {
        if (toolBudget.remaining() <= 0) break;
        const subKeywords = Array.isArray(query.keywords) ? query.keywords : [];
        const combined = [...mainKeywords, ...subKeywords].filter(Boolean);
        toolBudget.consume();
        await safePush(results, () => externalApi.search(searchPayload(combined), requestId), requestId);
      }
    }
  } else if (params.keywords) {
    toolBudget.consume();
    await safePush(results, () => externalApi.search(searchPayload(params.keywords), requestId), requestId);
  }

  for (const keywordSet of followupKeywordSets) {
    toolBudget.consume();
    await safePush(
      results,
      () => externalApi.search(searchPayload(keywordSet), requestId),
      requestId
    );
  }

  const expandIds = Array.isArray(params.expand_chunk_ids)
    ? params.expand_chunk_ids.slice(0, config.expand_limit)
    : [];
  for (const chunkId of expandIds) {
    toolBudget.consume();
    await safePush(
      results,
      () =>
        externalApi.navigate(
          { chunk_id: chunkId, direction: config.navigate_direction, steps: config.navigate_steps, language: "hi" },
          requestId
        ),
      requestId
    );
  }

  return results;
}

function buildQuery(keywords) {
  if (Array.isArray(keywords) && keywords.length) {
    return keywords.join(" ");
  }
  return String(keywords || "").trim();
}

function normalizeFollowupKeywordSets(followupKeywords) {
  if (!Array.isArray(followupKeywords)) return [];
  if (!followupKeywords.length) return [];
  if (typeof followupKeywords[0] === "string") return [followupKeywords];
  const sets = [];
  for (const entry of followupKeywords) {
    if (entry && Array.isArray(entry.keywords) && entry.keywords.length) {
      sets.push(entry.keywords);
    }
  }
  return sets;
}

function ensureBudget(toolBudget, needed) {
  if (toolBudget.remaining() < needed) {
    throw new Error("tool_call_budget_exceeded");
  }
}

function countUserSearches({ queries, mainQuery, subQueries, keywords }) {
  if (Array.isArray(queries) && queries.length) return queries.length;
  if (Array.isArray(subQueries) && subQueries.length) return subQueries.length;
  if (mainQuery && Array.isArray(mainQuery.keywords) && mainQuery.keywords.length) return 1;
  if (keywords) return 1;
  return 0;
}

async function safePush(results, fn, requestId) {
  try {
    const data = await fn();
    if (Array.isArray(data)) results.push(...data);
  } catch (err) {
    log.warn("workflow_call_failed", { requestId, error: err?.message || String(err) });
  }
}
