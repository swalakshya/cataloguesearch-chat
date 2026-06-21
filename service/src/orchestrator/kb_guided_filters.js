import { log } from "../utils/log.js";

/**
 * Derive guided filters from merged KB topic references.
 * Pure function — no I/O. Cap defaults to KB_GUIDED_FILTERS_CAP env var (default 5).
 */
export function deriveGuidedFilters(mergedTopics, cap) {
  const effectiveCap = cap != null ? cap : Number(process.env.KB_GUIDED_FILTERS_CAP || 5);
  if (effectiveCap <= 0) return [];
  const seen = new Set();
  const out = [];
  for (const t of (mergedTopics || [])) {
    for (const ref of (t.references ?? [])) {
      const f = {
        shastra: ref.shastra_natural_key ?? null,
        gatha: ref.gatha_number ?? null,
        page: ref.page_number ?? null,
        teeka: ref.teeka_natural_key ?? null,
      };
      if (Object.values(f).every((v) => v == null)) continue;
      const key = JSON.stringify(f);
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(f);
      if (out.length >= effectiveCap) return out;
    }
  }
  return out;
}

/**
 * Run one filtered search per guided filter and collect labelled buckets.
 *
 * The agent API is NOT modified for guided search: instead of asking the API
 * to run guided retrievals server-side, chat fires a separate `search` call
 * per guided filter and assembles the `guided_results[]` buckets itself.
 *
 * shastra (a natural_key) maps to the agent-search `granth` field — the only
 * shastra-level filter the agent search API exposes. gatha/page/teeka have no
 * corresponding agent-search field, so they are carried only in the returned
 * label (the LLM still sees them in the Step2 "Guided Passages" section).
 *
 * Returns `[{ guided_filter, results }]`. Best-effort: per-call failures are
 * logged and skipped; an empty/missing filter list returns `[]`.
 */
export async function fetchGuidedResults({
  externalApi,
  guidedFilters,
  baseFilters,
  query,
  language,
  requestId,
  toolBudget,
  pageSize,
}) {
  const filters = Array.isArray(guidedFilters) ? guidedFilters : [];
  if (!filters.length || !query) return [];
  const size = pageSize != null ? pageSize : Number(process.env.KB_GUIDED_PAGE_SIZE || 3);
  const out = [];
  for (const f of filters) {
    if (toolBudget && toolBudget.remaining() <= 0) break;
    const payload = {
      ...(baseFilters || {}),
      query,
      language: language || "hi",
      page_size: size,
      page: 1,
      ...(f && f.shastra ? { granth: f.shastra } : {}),
    };
    toolBudget?.consume();
    try {
      const results = await externalApi.search(payload, requestId);
      out.push({ guided_filter: f, results: Array.isArray(results) ? results : [] });
    } catch (err) {
      log.warn("guided_search_failed", {
        requestId,
        guided_filter: f,
        error: err?.message || String(err),
      });
    }
  }
  return out;
}
