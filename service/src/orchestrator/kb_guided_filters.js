import { log } from "../utils/log.js";
import { SHASTRA_CANONICAL_TRANSLATED_NAMING } from "../config/shastra_canonical_translated_naming.js";

// Map a Hindi shastra natural_key → all matching cataloguesearch english_names.
// One Hindi name can map to multiple english_names (e.g. समयसार → "Samaysaar"
// and "Samaysaar Kalash Tika"), so each is queried with its own agent API call.
const HINDI_TO_ENGLISH_NAMES = (() => {
  const m = new Map();
  for (const entry of SHASTRA_CANONICAL_TRANSLATED_NAMING) {
    if (!entry.hindi_name) continue;
    if (!m.has(entry.hindi_name)) m.set(entry.hindi_name, []);
    m.get(entry.hindi_name).push(entry.english_name);
  }
  return m;
})();

/**
 * Resolve a guided-filter shastra (a Hindi natural_key) to the cataloguesearch
 * `granth` english_name(s). Returns all matches; falls back to the raw value
 * when no mapping exists so callers still issue at least one query.
 */
export function resolveGranthNames(shastra) {
  if (!shastra) return [];
  return HINDI_TO_ENGLISH_NAMES.get(shastra) ?? [];
}

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
    // A shastra (Hindi natural_key) can map to multiple cataloguesearch
    // english_names; fire one search per matching granth english_name.
    // Skip entirely if no english_name mapping exists.
    const granthNames = f && f.shastra ? resolveGranthNames(f.shastra) : [];
    if (!granthNames.length) {
      log.warn("guided_search_skipped_no_mapping", { requestId, shastra: f?.shastra });
      continue;
    }
    for (const granth of granthNames) {
      if (toolBudget && toolBudget.remaining() <= 0) return out;
      const payload = {
        ...(baseFilters || {}),
        query,
        language: language || "hi",
        page_size: size,
        page: 1,
        ...(granth ? { granth } : {}),
      };
      toolBudget?.consume();
      try {
        const results = await externalApi.search(payload, requestId);
        out.push({
          guided_filter: f,
          granth: granth || null,
          results: Array.isArray(results) ? results : [],
        });
      } catch (err) {
        log.warn("guided_search_failed", {
          requestId,
          guided_filter: f,
          granth,
          error: err?.message || String(err),
        });
      }
    }
  }
  return out;
}
