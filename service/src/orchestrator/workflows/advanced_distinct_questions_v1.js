export async function runAdvancedDistinctQuestions({ externalApi, params, requestId, toolBudget }) {
  const results = [];
  const language = params.language || "hi";
  const filters = params.filters || {};
  const queries = Array.isArray(params.queries) ? params.queries : [];

  ensureBudget(toolBudget, queries.length);

  for (const query of queries) {
    const payload = {
      query: buildQuery(query.keywords),
      language,
      content_type: filters.content_type || ["Granth", "Books"],
      anuyog: filters.anuyog || null,
      granth: filters.granth || null,
      contributor: filters.contributor || null,
      year_from: filters.year_from || null,
      year_to: filters.year_to || null,
      page: 1,
      page_size: 10,
      rerank: true,
    };
    toolBudget.consume();
    await safePush(results, () => externalApi.search(payload, requestId), requestId);
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

async function safePush(results, fn, requestId) {
  try {
    const data = await fn();
    if (Array.isArray(data)) results.push(...data);
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
  }
}
