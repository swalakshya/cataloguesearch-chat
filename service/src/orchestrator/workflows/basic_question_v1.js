import { getWorkflowConfig } from "../../config/workflow_config.js";
import { normalizeContentTypes } from "../../config/content_types.js";

export async function runBasicQuestion({ externalApi, params, requestId, toolBudget, modelId }) {
  ensureBudget(toolBudget, 1);
  const query = buildQuery(params.keywords);
  const config = getWorkflowConfig(modelId).basic;
  const payload = {
    query,
    language: params.language || "hi",
    content_type: normalizeContentTypes(params.filters?.content_type),
    anuyog: params.filters?.anuyog || null,
    granth: params.filters?.granth || null,
    contributor: params.filters?.contributor || null,
    page: config.page,
    page_size: config.page_size,
    rerank: config.rerank,
  };
  toolBudget.consume();
  const results = await externalApi.search(payload, requestId);
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
