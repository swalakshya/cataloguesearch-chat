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

  const followupKeywordSets = normalizeFollowupKeywordSets(params.followup_keywords);
  const extraSearches = followupKeywordSets.length;
  ensureBudget(toolBudget, 1 + extraSearches + (params.expand_chunk_ids?.length || 0));

  toolBudget.consume();
  await safePush(results, () => externalApi.search(searchPayload(params.keywords), requestId), requestId);

  for (const keywordSet of followupKeywordSets) {
    toolBudget.consume();
    await safePush(
      results,
      () => externalApi.search(searchPayload(keywordSet), requestId),
      requestId
    );
  }

  const expandIds = Array.isArray(params.expand_chunk_ids) ? params.expand_chunk_ids.slice(0, 15) : [];
  for (const chunkId of expandIds) {
    toolBudget.consume();
    await safePush(
      results,
      () => externalApi.navigate({ chunk_id: chunkId, direction: "both", steps: 3, language: "hi" }, requestId),
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

function normalizeFollowupKeywordSets(followupKeywords) {
  if (!Array.isArray(followupKeywords)) return [];
  if (!followupKeywords.length) return [];
  if (typeof followupKeywords[0] === "string") return [followupKeywords];
  const sets = [];
  for (const entry of followupKeywords) {
    if (entry && Array.isArray(entry.keywords) && entry.keywords.length) {
      sets.push(entry.keywords);
    }
  }
  return sets;
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
