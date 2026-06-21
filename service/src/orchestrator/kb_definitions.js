import { log } from "../utils/log.js";

const DEFAULT_MAX_KEYWORDS = 15;

/**
 * Union jain_keywords (post-Phase 2 canonical) with matched_seed_keywords from
 * merged topics (Phase 3). Deduplicates and caps at KB_DEFINITIONS_MAX_KEYWORDS.
 */
export function collectUsedJainKeywords(keywordResult, mergedTopics) {
  const jainKws = Array.isArray(keywordResult?.jain_keywords) ? keywordResult.jain_keywords : [];

  const seedKws = [];
  for (const topic of (Array.isArray(mergedTopics) ? mergedTopics : [])) {
    const seeds = topic?.matched_seed_keywords;
    if (Array.isArray(seeds)) seedKws.push(...seeds);
  }

  const cap = Number(process.env.KB_DEFINITIONS_MAX_KEYWORDS || DEFAULT_MAX_KEYWORDS);
  const seen = new Set();
  const result = [];
  for (const kw of [...jainKws, ...seedKws]) {
    const k = String(kw || "").trim();
    if (!k || seen.has(k)) continue;
    seen.add(k);
    result.push(k);
    if (result.length >= cap) break;
  }
  return result;
}

/**
 * Fetch Hindi definitions for the given Jain keywords via a single batched KB call.
 * Returns `{ text, citations }` where `text` is the formatted context block ("" on
 * empty/failure) and `citations` is `[{ id, label, source_url }]` for keywords that
 * carry a jainkosh source_url (used to map cited KB IDs back to URLs). Never throws.
 */
export async function fetchKbDefinitions({ usedJainKeywords, kbApiClient, requestId }) {
  if (!Array.isArray(usedJainKeywords) || usedJainKeywords.length === 0) {
    log.verbose("kb_definitions_skip", { requestId, reason: "no_jain_keywords" });
    return { text: "", citations: [] };
  }

  const definitionsPerKeyword = Number(process.env.KB_DEFINITIONS_PER_KEYWORD || 0);

  try {
    log.info("kb_definitions_start", { requestId, keywords: usedJainKeywords.length });
    const resolved = await kbApiClient.keywordResolveBatch(
      usedJainKeywords,
      { fuzzyTopK: 0, includeDefinitions: true, definitionsPerKeyword },
      requestId
    );

    if (!Array.isArray(resolved) || resolved.length === 0) {
      log.verbose("kb_definitions_empty", { requestId });
      return { text: "", citations: [] };
    }

    const { text, citations } = formatKbDefinitionsContext(resolved);
    const withDefs = resolved.filter((r) => Array.isArray(r?.definitions) && r.definitions.length > 0).length;
    log.info("kb_definitions_fetched", {
      requestId,
      total: resolved.length,
      withDefinitions: withDefs,
      citableUrls: citations.length,
    });
    return { text, citations };
  } catch (err) {
    log.warn("kb_definitions_failed", { requestId, error: err?.message || String(err) });
    return { text: "", citations: [] };
  }
}

/**
 * Render resolved keyword entries into a "### KB Definitions (Hindi)" context block.
 * Items without definitions are skipped. Each rendered keyword that carries a
 * jainkosh `source_url` is tagged with a stable citable id (`KB-D-<n>`) so the
 * Step2 LLM can cite it via the `scoring` array.
 *
 * Returns `{ text, citations }`. `text` is "" when nothing to show; `citations`
 * is `[{ id, label, source_url }]` for the tagged keywords.
 */
export function formatKbDefinitionsContext(resolvedKeywords) {
  if (!Array.isArray(resolvedKeywords) || resolvedKeywords.length === 0) {
    return { text: "", citations: [] };
  }

  const lines = ["### KB Definitions (Hindi)"];
  const citations = [];
  let hasAny = false;

  for (const item of resolvedKeywords) {
    const defs = Array.isArray(item?.definitions) ? item.definitions : [];
    if (defs.length === 0) continue;

    const nk = String(item?.keyword_natural_key || item?.input_token || "").trim();
    const display = String(item?.input_token || nk).trim();
    if (!display) continue;

    const sourceUrl = String(item?.source_url || "").trim();
    let idTag = "";
    if (sourceUrl) {
      const id = `KB-D-${citations.length + 1}`;
      citations.push({ id, label: display, source_url: sourceUrl });
      idTag = `[${id}] `;
    }

    lines.push(`- ${idTag}${display} (nk=${nk}):`);
    let defIdx = 1;
    for (const def of defs) {
      const text = String(def?.text_hi || def?.text || "").trim();
      if (!text) continue;
      lines.push(`    ${defIdx}. ${text}`);
      defIdx++;
    }
    hasAny = true;
  }

  return { text: hasAny ? lines.join("\n") : "", citations };
}
