import { getWorkflowConfig } from "../../config/workflow_config.js";
import { normalizeContentTypes } from "../../config/content_types.js";
import { deriveGuidedFilters, fetchGuidedResults } from "../kb_guided_filters.js";
import { log } from "../../utils/log.js";

export async function runAdvancedDistinctQuestions({ externalApi, params, requestId, toolBudget, modelId }) {
  const chunks = [];
  const gujChunks = Boolean(params.gujChunks);
  const language = params.language || "hi";
  const filters = params.filters || {};
  const queries = Array.isArray(params.queries) ? params.queries : [];
  const config = getWorkflowConfig(modelId);
  const distConfig = config.advanced_distinct;

  const mergedTopics = Array.isArray(params.mergedTopics) ? params.mergedTopics : [];
  const guidedFilters = deriveGuidedFilters(mergedTopics);

  // Count budget: each query uses 1 Hindi call + 1 Gujarati call (if keywords_guj present)
  const budgetNeeded = queries.reduce((sum, q) => {
    const hasGuj = gujChunks && Array.isArray(q.keywords_guj) && q.keywords_guj.length > 0;
    return sum + (hasGuj ? 2 : 1);
  }, 0);
  ensureBudget(toolBudget, budgetNeeded);

  const baseFilters = {
    content_type: normalizeContentTypes(filters.content_type),
    anuyog: filters.anuyog || null,
    granth: filters.granth || null,
    contributor: filters.contributor || null,
    page: distConfig.page,
    rerank: distConfig.rerank,
  };

  let primaryHindiQuery = "";

  for (const query of queries) {
    const hasGuj = gujChunks && Array.isArray(query.keywords_guj) && query.keywords_guj.length > 0;
    const hindiQuery = buildQuery(query.keywords);
    if (!primaryHindiQuery) primaryHindiQuery = hindiQuery;
    const hindiPayload = {
      ...baseFilters,
      query: hindiQuery,
      language,
      page_size: distConfig.page_size,
    };
    toolBudget.consume();

    if (!hasGuj) {
      await safePush(chunks, () => externalApi.search(hindiPayload, requestId), requestId, "hi");
      continue;
    }

    toolBudget.consume();
    const gujPayload = {
      ...baseFilters,
      query: buildQuery(query.keywords_guj),
      language: "gu",
      page_size: config.gujarati_page_size,
    };
    const [hindiResults, gujResults] = await Promise.all([
      safeFetch(() => externalApi.search(hindiPayload, requestId), requestId),
      safeFetch(() => externalApi.search(gujPayload, requestId), requestId),
    ]);
    hindiResults.forEach((c) => { c._lang = "hi"; });
    gujResults.forEach((c) => { c._lang = "gu"; });
    chunks.push(...hindiResults, ...gujResults);
  }

  // Fire one filtered search per guided filter, reusing the first query.
  const guidedResults = await fetchGuidedResults({
    externalApi,
    guidedFilters,
    baseFilters,
    query: primaryHindiQuery,
    language,
    requestId,
    toolBudget,
  });

  return { chunks, guidedResults };
}

function buildQuery(keywords) {
  if (Array.isArray(keywords) && keywords.length) {
    return keywords.join(" ");
  }
  return String(keywords || "").trim();
}

function ensureBudget(toolBudget, needed) {
  if (toolBudget.remaining() < needed) {
    throw new Error("tool_call_budget_exceeded");
  }
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

async function safePush(chunks, fn, requestId, lang) {
  const results = await safeFetch(fn, requestId);
  if (lang) results.forEach((c) => { c._lang = lang; });
  chunks.push(...results);
}
