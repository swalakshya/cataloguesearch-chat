import { log } from "../utils/log.js";

/**
 * Fires parallel kb metadata lookups for every shastra/author hint in kbEntities.
 * Returns null when kbApiClient is absent or no hints present.
 * Individual call failures are caught per-hint so a single timeout never blocks the pipeline.
 */
export async function fetchKbMetadataMatches(kbApiClient, kbEntities, requestId) {
  if (!kbApiClient || !kbEntities) return null;

  const shastraHints = Array.isArray(kbEntities.shastra_hints)
    ? kbEntities.shastra_hints.filter(Boolean)
    : [];
  const authorHints = Array.isArray(kbEntities.author_hints)
    ? kbEntities.author_hints.filter(Boolean)
    : [];

  if (!shastraHints.length && !authorHints.length) return null;

  const shastraCalls = shastraHints.map((hint) =>
    kbApiClient
      .shastras({ q: hint, fuzzy: true, limit: 5 }, requestId)
      .catch((err) => {
        log.warn("kb_shastras_failed", { requestId, hint, error: err?.message || String(err) });
        return [];
      })
  );

  const authorCalls = authorHints.map((hint) =>
    kbApiClient
      .authors({ q: hint, fuzzy: true, limit: 5 }, requestId)
      .catch((err) => {
        log.warn("kb_authors_failed", { requestId, hint, error: err?.message || String(err) });
        return [];
      })
  );

  const [shastraResults, authorResults] = await Promise.all([
    Promise.all(shastraCalls),
    Promise.all(authorCalls),
  ]);

  const shastraMatches = dedupeByNaturalKey(shastraResults.flat());
  const authorMatches = dedupeByNaturalKey(authorResults.flat());

  log.info("kb_metadata_matches_fetched", {
    requestId,
    shastraHints: shastraHints.length,
    authorHints: authorHints.length,
    shastraMatches: shastraMatches.length,
    authorMatches: authorMatches.length,
  });

  return { shastraMatches, authorMatches };
}

/**
 * Formats the KB Metadata Matches context section.
 * Returns empty string when there are no matches (omits empty heading per spec).
 */
export function buildKbMetadataSection(kbMatches) {
  if (!kbMatches) return "";
  const { shastraMatches = [], authorMatches = [] } = kbMatches;
  if (!shastraMatches.length && !authorMatches.length) return "";

  const lines = [];
  for (const m of shastraMatches) {
    const sim = m.similarity != null ? `, sim=${Number(m.similarity).toFixed(2)}` : "";
    lines.push(`- shastra: ${m.name} (nk=${m.natural_key}${sim})`);
  }
  for (const m of authorMatches) {
    const sim = m.similarity != null ? `, sim=${Number(m.similarity).toFixed(2)}` : "";
    lines.push(`- author:  ${m.name} (nk=${m.natural_key}${sim})`);
  }

  if (!lines.length) return "";
  return `### KB Metadata Matches (closest first)\n${lines.join("\n")}`;
}

function dedupeByNaturalKey(items) {
  const seen = new Set();
  return (Array.isArray(items) ? items : []).filter((item) => {
    if (!item || !item.natural_key) return false;
    if (seen.has(item.natural_key)) return false;
    seen.add(item.natural_key);
    return true;
  });
}
