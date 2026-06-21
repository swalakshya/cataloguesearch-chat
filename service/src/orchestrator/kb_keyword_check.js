import { runKeywordFix } from "./keyword_fix.js";
import { log } from "../utils/log.js";

const MATCHED_KINDS = new Set(["exact", "alias", "suffix_strip"]);

/**
 * Validate jain_keywords[] against the KB dictionary, apply canonical rewrites,
 * and conditionally fire Step1b when missed keywords have high-confidence suggestions.
 *
 * Returns an updated step1Result (original is not mutated).
 * Adds kb_canonical_map: { original_token → canonical } for Phase 7.
 */
export async function runKbKeywordCheck({
  step1Result,
  kbApiClient,
  provider,
  question,
  requestId,
  modelId,
  gujChunks = false,
  llmCallsCollector,
  runKeywordFixFn = runKeywordFix,
}) {
  const jainKeywords = Array.isArray(step1Result.jain_keywords) ? step1Result.jain_keywords : [];

  if (jainKeywords.length === 0) {
    log.verbose("kb_keyword_check_skip", { requestId, reason: "no_jain_keywords" });
    return step1Result;
  }

  let resolutions;
  try {
    resolutions = await kbApiClient.keywordResolveBatch(
      jainKeywords,
      { fuzzyTopK: 5, includeDefinitions: false },
      requestId
    );
  } catch (err) {
    log.warn("kb_keyword_check_resolve_failed", {
      requestId,
      error: err?.message || String(err),
    });
    // Graceful degradation: continue without KB enrichment
    return step1Result;
  }

  if (!Array.isArray(resolutions) || resolutions.length === 0) {
    log.verbose("kb_keyword_check_empty_resolutions", { requestId });
    return step1Result;
  }

  const matched = resolutions.filter((r) => MATCHED_KINDS.has(r?.match_kind));
  const missed = resolutions.filter((r) => r?.match_kind === "none");

  log.info("kb_keyword_check_split", {
    requestId,
    total: resolutions.length,
    matched: matched.length,
    missed: missed.length,
  });

  // Build canonical replacement map for tokens that differ from their natural key
  const canonicalMap = {};
  for (const resolution of matched) {
    const original = resolution.input_token;
    const canonical = resolution.keyword_natural_key;
    if (original && canonical && original !== canonical) {
      canonicalMap[original] = canonical;
    }
  }

  let result = { ...step1Result };

  if (Object.keys(canonicalMap).length > 0) {
    result = applyCanonicalRewrite(result, canonicalMap);
    log.info("kb_canonical_rewrite_applied", { requestId, canonicalMap });
  }

  // Store canonical map for Phase 7 (definitions lookup)
  result.kb_canonical_map = canonicalMap;

  // Determine if Step1b should fire for missed keywords with suggestions
  const missedWithSuggestions = missed
    .filter((r) => Array.isArray(r?.suggestions) && r.suggestions.length > 0)
    .map((r) => ({
      token: r.input_token,
      suggestions: r.suggestions.map((s) => ({
        kw: s.keyword || s.kw || "",
        similarity: typeof s.similarity === "number" ? s.similarity : 0,
      })),
    }));

  if (missed.length === 0) {
    log.verbose("kb_keyword_check_step1b_skip", { requestId, reason: "no_misses" });
    return result;
  }

  if (missedWithSuggestions.length === 0) {
    log.verbose("kb_keyword_check_step1b_skip", { requestId, reason: "no_suggestions_for_misses" });
    return result;
  }

  log.info("kb_keyword_check_step1b_trigger", {
    requestId,
    missed_count: missed.length,
    with_suggestions: missedWithSuggestions.length,
  });

  const fixed = await runKeywordFixFn({
    provider,
    question,
    step1Json: result,
    requestId,
    modelId,
    gujChunks,
    llmCallsCollector,
    missedWithSuggestions,
  });

  // Preserve kb_canonical_map through the Step1b rewrite
  return { ...fixed, kb_canonical_map: result.kb_canonical_map };
}

function applyCanonicalRewrite(result, canonicalMap) {
  const rewrite = (arr) =>
    Array.isArray(arr) ? arr.map((k) => canonicalMap[k] ?? k) : arr;
  return {
    ...result,
    keywords: rewrite(result.keywords),
    jain_keywords: rewrite(result.jain_keywords),
  };
}
