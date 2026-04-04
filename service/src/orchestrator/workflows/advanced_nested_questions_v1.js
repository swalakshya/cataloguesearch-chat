import { WORKFLOW_CONFIG } from "../../config/workflow_config.js";

export async function runAdvancedNestedQuestions({ externalApi, params, requestId, toolBudget }) {
  const results = [];
  const language = params.language || "hi";
  const filters = params.filters || {};
  const mainQuery = params.main_query || {};
  const subQueries = Array.isArray(params.sub_queries) ? params.sub_queries : [];
  const config = WORKFLOW_CONFIG.advanced_nested;

  const searchPayload = (keywords, pageSize) => ({
    query: buildQuery(keywords),
    language,
    content_type: filters.content_type || ["Granth", "Books"],
    anuyog: filters.anuyog || null,
    granth: filters.granth || null,
    contributor: filters.contributor || null,
    page: config.page,
    page_size: pageSize,
    rerank: config.rerank,
  });

  const estimatedCalls = subQueries.length || 1;
  ensureBudget(toolBudget, estimatedCalls);

  const mainKeywords = Array.isArray(mainQuery.keywords) ? mainQuery.keywords : [];
  if (subQueries.length === 0) {
    toolBudget.consume();
    await safePush(results, () => externalApi.search(searchPayload(mainKeywords, config.page_size), requestId), requestId);
    return results;
  }

  for (const query of subQueries) {
    if (toolBudget.remaining() <= 0) break;
    const subKeywords = Array.isArray(query.keywords) ? query.keywords : [];
    const combined = [...mainKeywords, ...subKeywords].filter(Boolean);
    toolBudget.consume();
    await safePush(results, () => externalApi.search(searchPayload(combined, config.page_size), requestId), requestId);
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
    return await fn();
  } catch (err) {
    const message = err?.message || String(err);
    console.warn(
      JSON.stringify({
        ts: new Date().toISOString(),
        level: "warn",
        message: "workflow_call_failed",
        requestId,
        error: message,
      })
    );
    return [];
  }
}

async function safePush(results, fn, requestId) {
  const data = await safeFetch(fn, requestId);
  if (Array.isArray(data)) results.push(...data);
}
