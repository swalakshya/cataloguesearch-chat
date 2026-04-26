import { getWorkflowConfig } from "../../config/workflow_config.js";
import { normalizeContentTypes } from "../../config/content_types.js";
import { log } from "../../utils/log.js";

export async function runAdvancedNestedQuestions({ externalApi, params, requestId, toolBudget, modelId }) {
  const results = [];
  const gujChunks = Boolean(params.gujChunks);
  const language = params.language || "hi";
  const filters = params.filters || {};
  const mainQuery = params.main_query || {};
  const subQueries = Array.isArray(params.sub_queries) ? params.sub_queries : [];
  const config = getWorkflowConfig(modelId);
  const nestedConfig = config.advanced_nested;

  const mainKeywords = Array.isArray(mainQuery.keywords) ? mainQuery.keywords : [];
  const mainKeywordsGuj = Array.isArray(mainQuery.keywords_guj) ? mainQuery.keywords_guj : [];
  const hasMainGuj = gujChunks && mainKeywordsGuj.length > 0;

  const baseFilters = {
    content_type: normalizeContentTypes(filters.content_type),
    anuyog: filters.anuyog || null,
    granth: filters.granth || null,
    contributor: filters.contributor || null,
    page: nestedConfig.page,
    rerank: nestedConfig.rerank,
  };

  // Budget: main (1 or 2) + each sub (1 or 2)
  const subBudget = subQueries.reduce((sum, q) => {
    const hasGuj = gujChunks && Array.isArray(q.keywords_guj) && q.keywords_guj.length > 0;
    return sum + (hasGuj ? 2 : 1);
  }, 0);
  const estimatedCalls = (hasMainGuj ? 2 : 1) + (subQueries.length ? subBudget : 0);
  ensureBudget(toolBudget, estimatedCalls);

  // Main query
  const mainHindiPayload = { ...baseFilters, query: buildQuery(mainKeywords), language, page_size: nestedConfig.page_size };
  toolBudget.consume();

  if (hasMainGuj) {
    toolBudget.consume();
    const mainGujPayload = { ...baseFilters, query: buildQuery(mainKeywordsGuj), language: "gu", page_size: config.gujarati_page_size };
    const [hindiData, gujData] = await Promise.all([
      safeFetch(() => externalApi.search(mainHindiPayload, requestId), requestId),
      safeFetch(() => externalApi.search(mainGujPayload, requestId), requestId),
    ]);
    hindiData.forEach((c) => { c._lang = "hi"; });
    gujData.forEach((c) => { c._lang = "gu"; });
    results.push(...hindiData, ...gujData);
  } else {
    const data = await safeFetch(() => externalApi.search(mainHindiPayload, requestId), requestId);
    data.forEach((c) => { c._lang = "hi"; });
    results.push(...data);
  }

  // Sub queries
  for (const query of subQueries) {
    if (toolBudget.remaining() <= 0) break;
    const subKeywords = Array.isArray(query.keywords) ? query.keywords : [];
    const subKeywordsGuj = Array.isArray(query.keywords_guj) ? query.keywords_guj : [];
    const hasSubGuj = gujChunks && subKeywordsGuj.length > 0;

    const combinedHindi = [...mainKeywords, ...subKeywords].filter(Boolean);
    const subHindiPayload = { ...baseFilters, query: buildQuery(combinedHindi), language, page_size: nestedConfig.page_size };
    toolBudget.consume();

    if (hasSubGuj) {
      if (toolBudget.remaining() < 1) {
        const data = await safeFetch(() => externalApi.search(subHindiPayload, requestId), requestId);
        data.forEach((c) => { c._lang = "hi"; });
        results.push(...data);
        continue;
      }
      toolBudget.consume();
      const combinedGuj = [...mainKeywordsGuj, ...subKeywordsGuj].filter(Boolean);
      const subGujPayload = { ...baseFilters, query: buildQuery(combinedGuj), language: "gu", page_size: config.gujarati_page_size };
      const [hindiData, gujData] = await Promise.all([
        safeFetch(() => externalApi.search(subHindiPayload, requestId), requestId),
        safeFetch(() => externalApi.search(subGujPayload, requestId), requestId),
      ]);
      hindiData.forEach((c) => { c._lang = "hi"; });
      gujData.forEach((c) => { c._lang = "gu"; });
      results.push(...hindiData, ...gujData);
    } else {
      const data = await safeFetch(() => externalApi.search(subHindiPayload, requestId), requestId);
      data.forEach((c) => { c._lang = "hi"; });
      results.push(...data);
    }
  }

  return results;
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
