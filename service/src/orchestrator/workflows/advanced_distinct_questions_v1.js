import { getWorkflowConfig } from "../../config/workflow_config.js";
import { normalizeContentTypes } from "../../config/content_types.js";
import { log } from "../../utils/log.js";

export async function runAdvancedDistinctQuestions({ externalApi, params, requestId, toolBudget, modelId }) {
  const results = [];
  const gujChunks = Boolean(params.gujChunks);
  const language = params.language || "hi";
  const filters = params.filters || {};
  const queries = Array.isArray(params.queries) ? params.queries : [];
  const config = getWorkflowConfig(modelId);
  const distConfig = config.advanced_distinct;

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

  for (const query of queries) {
    const hasGuj = gujChunks && Array.isArray(query.keywords_guj) && query.keywords_guj.length > 0;
    const hindiPayload = {
      ...baseFilters,
      query: buildQuery(query.keywords),
      language,
      page_size: distConfig.page_size,
    };
    toolBudget.consume();

    if (!hasGuj) {
      await safePush(results, () => externalApi.search(hindiPayload, requestId), requestId, "hi");
      continue;
    }

    toolBudget.consume();
    const gujPayload = {
      ...baseFilters,
      query: buildQuery(query.keywords_guj),
      language: "gu",
      page_size: config.gujarati_page_size,
    };
    const [hindiData, gujData] = await Promise.all([
      safeFetch(() => externalApi.search(hindiPayload, requestId), requestId),
      safeFetch(() => externalApi.search(gujPayload, requestId), requestId),
    ]);
    hindiData.forEach((c) => { c._lang = "hi"; });
    gujData.forEach((c) => { c._lang = "gu"; });
    results.push(...hindiData, ...gujData);
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

async function safePush(results, fn, requestId, lang) {
  const data = await safeFetch(fn, requestId);
  if (lang) data.forEach((c) => { c._lang = lang; });
  results.push(...data);
}
