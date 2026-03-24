export async function runFollowupQuestion({ externalApi, params, requestId, toolBudget }) {
  const results = [];
  const language = params.language || "hi";
  const filters = params.filters || {};

  const searchPayload = (keywords) => ({
    query: buildQuery(keywords),
    language,
    content_type: filters.content_type || ["Granth", "Books"],
    anuyog: filters.anuyog || null,
    granth: filters.granth || null,
    contributor: filters.contributor || null,
    year_from: filters.year_from || null,
    year_to: filters.year_to || null,
    page: 1,
    page_size: 15,
    rerank: true,
  });

  const extraSearch = params.followup_keywords && params.followup_keywords.length ? 1 : 0;
  ensureBudget(toolBudget, 1 + extraSearch + (params.expand_chunk_ids?.length || 0));

  toolBudget.consume();
  await safePush(results, () => externalApi.search(searchPayload(params.keywords), requestId), requestId);

  if (params.followup_keywords && params.followup_keywords.length) {
    toolBudget.consume();
    await safePush(
      results,
      () => externalApi.search(searchPayload(params.followup_keywords), requestId),
      requestId
    );
  }

  const expandIds = Array.isArray(params.expand_chunk_ids) ? params.expand_chunk_ids : [];
  for (const chunkId of expandIds) {
    toolBudget.consume();
    await safePush(
      results,
      () => externalApi.navigate({ chunk_id: chunkId, direction: "both", steps: 3 }, requestId),
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
