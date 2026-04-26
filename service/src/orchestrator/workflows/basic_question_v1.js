import { getWorkflowConfig } from "../../config/workflow_config.js";
import { normalizeContentTypes } from "../../config/content_types.js";
import { log } from "../../utils/log.js";

export async function runBasicQuestion({ externalApi, params, requestId, toolBudget, modelId }) {
  const gujChunks = Boolean(params.gujChunks);
  const hasGujKeywords = gujChunks && Array.isArray(params.keywords_guj) && params.keywords_guj.length > 0;
  ensureBudget(toolBudget, hasGujKeywords ? 2 : 1);

  const config = getWorkflowConfig(modelId);
  const basicConfig = config.basic;
  const baseFilters = {
    content_type: normalizeContentTypes(params.filters?.content_type),
    anuyog: params.filters?.anuyog || null,
    granth: params.filters?.granth || null,
    contributor: params.filters?.contributor || null,
    page: basicConfig.page,
    rerank: basicConfig.rerank,
  };

  const hindiPayload = {
    ...baseFilters,
    query: buildQuery(params.keywords),
    language: params.language || "hi",
    page_size: basicConfig.page_size,
  };

  toolBudget.consume();

  if (!hasGujKeywords) {
    return await externalApi.search(hindiPayload, requestId);
  }

  toolBudget.consume();
  const gujPayload = {
    ...baseFilters,
    query: buildQuery(params.keywords_guj),
    language: "gu",
    page_size: config.gujarati_page_size,
  };

  const [hindiResults, gujResults] = await Promise.all([
    safeFetch(() => externalApi.search(hindiPayload, requestId), requestId),
    safeFetch(() => externalApi.search(gujPayload, requestId), requestId),
  ]);

  hindiResults.forEach((c) => { c._lang = "hi"; });
  gujResults.forEach((c) => { c._lang = "gu"; });
  return [...hindiResults, ...gujResults];
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
