export async function runAdvancedNestedQuestions({ externalApi, params, requestId, toolBudget }) {
  const results = [];
  const language = params.language || "hi";
  const filters = params.filters || {};
  const mainQuery = params.main_query || {};
  const subQueries = Array.isArray(params.sub_queries) ? params.sub_queries : [];

  const searchPayload = (keywords, pageSize) => ({
    query: buildQuery(keywords),
    language,
    content_type: filters.content_type || ["Granth", "Books"],
    anuyog: filters.anuyog || null,
    granth: filters.granth || null,
    contributor: filters.contributor || null,
    year_from: filters.year_from || null,
    year_to: filters.year_to || null,
    page: 1,
    page_size: pageSize,
    rerank: true,
  });

  const estimatedCalls = 1 + subQueries.length;
  ensureBudget(toolBudget, estimatedCalls);

  toolBudget.consume();
  const mainResults = await safeFetch(
    () => externalApi.search(searchPayload(mainQuery.keywords, 10), requestId),
    requestId
  );
  if (Array.isArray(mainResults)) {
    results.push(...mainResults);
  }

  for (const chunk of Array.isArray(mainResults) ? mainResults : []) {
    if (!chunk?.chunk_id) continue;
    if (toolBudget.remaining() <= 0) break;
    toolBudget.consume();
    await safePush(
      results,
      () => externalApi.navigate({ chunk_id: chunk.chunk_id, direction: "both", steps: 3 }, requestId),
      requestId
    );
  }

  for (const query of subQueries) {
    if (toolBudget.remaining() <= 0) break;
    toolBudget.consume();
    await safePush(results, () => externalApi.search(searchPayload(query.keywords, 10), requestId), requestId);
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
