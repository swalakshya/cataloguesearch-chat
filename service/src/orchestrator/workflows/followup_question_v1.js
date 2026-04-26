import { getWorkflowConfig } from "../../config/workflow_config.js";
import { normalizeContentTypes } from "../../config/content_types.js";
import { log } from "../../utils/log.js";

export async function runFollowupQuestion({ externalApi, params, requestId, toolBudget, modelId }) {
  const results = [];
  const gujChunks = Boolean(params.gujChunks);
  const language = params.language || "hi";
  const filters = params.filters || {};
  const queries = Array.isArray(params.queries) ? params.queries : [];
  const mainQuery = params.main_query || {};
  const subQueries = Array.isArray(params.sub_queries) ? params.sub_queries : [];
  const config = getWorkflowConfig(modelId);
  const followupConfig = config.followup;

  const baseFilters = {
    content_type: normalizeContentTypes(filters.content_type),
    anuyog: filters.anuyog || null,
    granth: filters.granth || null,
    contributor: filters.contributor || null,
    page: followupConfig.page,
    rerank: followupConfig.rerank,
  };

  const hindiPayload = (keywords) => ({
    ...baseFilters,
    query: buildQuery(keywords),
    language,
    page_size: followupConfig.page_size,
  });

  const gujPayload = (keywords) => ({
    ...baseFilters,
    query: buildQuery(keywords),
    language: "gu",
    page_size: config.gujarati_page_size,
  });

  // Helper: fire a paired search (Hindi + optional Gujarati) and push tagged results
  async function searchPair(hindiKws, gujKws) {
    const hasGuj = gujChunks && Array.isArray(gujKws) && gujKws.length > 0;
    toolBudget.consume();
    if (!hasGuj) {
      const data = await safeFetch(() => externalApi.search(hindiPayload(hindiKws), requestId), requestId);
      data.forEach((c) => { c._lang = "hi"; });
      results.push(...data);
      return;
    }
    toolBudget.consume();
    const [hindiData, gujData] = await Promise.all([
      safeFetch(() => externalApi.search(hindiPayload(hindiKws), requestId), requestId),
      safeFetch(() => externalApi.search(gujPayload(gujKws), requestId), requestId),
    ]);
    hindiData.forEach((c) => { c._lang = "hi"; });
    gujData.forEach((c) => { c._lang = "gu"; });
    results.push(...hindiData, ...gujData);
  }

  const followupKeywordSets = normalizeFollowupKeywordSets(params.followup_keywords);
  const userSearches = countUserSearches({ queries, mainQuery, subQueries, keywords: params.keywords });
  const extraSearches = followupKeywordSets.length;
  const expandCount = Array.isArray(params.expand_chunk_ids)
    ? Math.min(followupConfig.expand_limit, params.expand_chunk_ids.length)
    : 0;
  // Estimate budget: each search may double if guj keywords present (conservative: 2x)
  const gujMultiplier = gujChunks ? 2 : 1;
  ensureBudget(toolBudget, (userSearches + extraSearches) * gujMultiplier + expandCount);

  if (queries.length) {
    for (const query of queries) {
      if (toolBudget.remaining() <= 0) break;
      await searchPair(query.keywords, query.keywords_guj);
    }
  } else if (subQueries.length || (mainQuery && Array.isArray(mainQuery.keywords))) {
    const mainKeywords = Array.isArray(mainQuery.keywords) ? mainQuery.keywords : [];
    const mainKeywordsGuj = Array.isArray(mainQuery.keywords_guj) ? mainQuery.keywords_guj : [];
    if (!subQueries.length) {
      if (toolBudget.remaining() > 0) {
        await searchPair(mainKeywords, mainKeywordsGuj);
      }
    } else {
      for (const query of subQueries) {
        if (toolBudget.remaining() <= 0) break;
        const subKeywords = Array.isArray(query.keywords) ? query.keywords : [];
        const subKeywordsGuj = Array.isArray(query.keywords_guj) ? query.keywords_guj : [];
        const combinedHindi = [...mainKeywords, ...subKeywords].filter(Boolean);
        const combinedGuj = [...mainKeywordsGuj, ...subKeywordsGuj].filter(Boolean);
        await searchPair(combinedHindi, combinedGuj);
      }
    }
  } else if (params.keywords) {
    await searchPair(params.keywords, params.keywords_guj);
  }

  for (const set of followupKeywordSets) {
    if (toolBudget.remaining() <= 0) break;
    await searchPair(set.hindi, set.guj);
  }

  // Navigation/expansion calls are language-agnostic — chunk IDs come from LLM
  // scoring of conversation history and can belong to any language.
  const expandIds = Array.isArray(params.expand_chunk_ids)
    ? params.expand_chunk_ids.slice(0, followupConfig.expand_limit)
    : [];
  for (const chunkId of expandIds) {
    if (toolBudget.remaining() <= 0) break;
    toolBudget.consume();
    const data = await safeFetch(
      () => externalApi.navigate(
        { chunk_id: chunkId, direction: followupConfig.navigate_direction, steps: followupConfig.navigate_steps, language: "hi" },
        requestId
      ),
      requestId
    );
    // Navigation results inherit the language of their source chunk; leave untagged
    // so they fall through as Hindi in the context split (safe default).
    results.push(...data);
  }

  return results;
}

function buildQuery(keywords) {
  if (Array.isArray(keywords) && keywords.length) {
    return keywords.join(" ");
  }
  return String(keywords || "").trim();
}

// Returns an array of { hindi: [...], guj: [...] } objects for each followup set
function normalizeFollowupKeywordSets(followupKeywords) {
  if (!Array.isArray(followupKeywords)) return [];
  if (!followupKeywords.length) return [];
  // Legacy: plain string array (v1 schema)
  if (typeof followupKeywords[0] === "string") {
    return [{ hindi: followupKeywords, guj: [] }];
  }
  const sets = [];
  for (const entry of followupKeywords) {
    if (entry && Array.isArray(entry.keywords) && entry.keywords.length) {
      sets.push({
        hindi: entry.keywords,
        guj: Array.isArray(entry.keywords_guj) ? entry.keywords_guj : [],
      });
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

async function safeFetch(fn, requestId) {
  try {
    const data = await fn();
    return Array.isArray(data) ? data : [];
  } catch (err) {
    log.warn("workflow_call_failed", { requestId, error: err?.message || String(err) });
    return [];
  }
}
