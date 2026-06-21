/**
 * KB citation merge helpers.
 *
 * KB context items (keyword definitions, topic extracts) are tagged in the Step2
 * context with stable ids (`KB-D-<n>`, `KB-T-<n>`). The Step2 LLM reports the KB
 * items it actually used by including those ids in the same `scoring` array it
 * uses for chunk ids. These helpers turn the cited KB ids back into reference
 * strings + structured citations (carrying the jainkosh `source_url`) so they can
 * be merged into the answer's `references[]` alongside chunk references.
 */

const KB_ID_PATTERN = /^KB-[TD]-\d+$/;

/**
 * Build a lookup map from a list of KB citation descriptors.
 * @param {Array<{id:string,label:string,source_url:string}>} citations
 * @returns {Map<string,{id:string,label:string,source_url:string}>}
 */
export function buildKbCitationMap(...citationLists) {
  const map = new Map();
  for (const list of citationLists) {
    if (!Array.isArray(list)) continue;
    for (const entry of list) {
      const id = String(entry?.id || "").trim();
      const sourceUrl = String(entry?.source_url || "").trim();
      if (!id || !sourceUrl) continue;
      if (map.has(id)) continue;
      map.set(id, { id, label: String(entry?.label || id).trim() || id, source_url: sourceUrl });
    }
  }
  return map;
}

/**
 * Format a single KB reference line. Mirrors the chunk reference style of
 * "<label> ... — <url>" so KB sources render identically in references[].
 */
export function formatKbReference({ label, source_url }, language = "") {
  const isHindi = String(language || "").toLowerCase() === "hi";
  const sourceLabel = isHindi ? "जैनकोष" : "jainkosh";
  const head = String(label || "").trim();
  const url = String(source_url || "").trim();
  if (!url) return "";
  return [head ? `${head} (${sourceLabel})` : `(${sourceLabel})`, url].join(" — ");
}

/**
 * From the LLM `scoring` array, extract KB ids that resolve in `kbCitationMap`,
 * dedupe, sort by descending score, and build `{ references, citations }`.
 *
 * @param {Object} params
 * @param {Array<{chunk_id?:string,score?:number}>} params.scoring
 * @param {Map<string,{id,label,source_url}>} params.kbCitationMap
 * @param {string} [params.language]
 * @returns {{references: string[], citations: object[]}}
 */
export function buildKbReferencesFromScoring({ scoring, kbCitationMap, language = "" } = {}) {
  const map = kbCitationMap instanceof Map ? kbCitationMap : new Map();
  if (!Array.isArray(scoring) || map.size === 0) {
    return { references: [], citations: [] };
  }

  const bestById = new Map();
  for (const entry of scoring) {
    if (!entry || typeof entry !== "object") continue;
    const id = String(entry.chunk_id || "").trim();
    if (!KB_ID_PATTERN.test(id)) continue;
    if (!map.has(id)) continue;
    const score = Number(entry.score);
    const normalized = Number.isFinite(score) ? Math.max(1, Math.min(100, Math.trunc(score))) : 1;
    const existing = bestById.get(id);
    if (!existing || normalized > existing) bestById.set(id, normalized);
  }

  const ordered = Array.from(bestById.entries()).sort((a, b) => b[1] - a[1]);

  const references = [];
  const citations = [];
  const isHindi = String(language || "").toLowerCase() === "hi";
  const sourceLabel = isHindi ? "जैनकोष" : "jainkosh";
  for (const [id] of ordered) {
    const desc = map.get(id);
    const reference = formatKbReference(desc, language);
    if (!reference) continue;
    references.push(reference);
    citations.push({
      granth: desc.label,
      category: sourceLabel,
      file_url: desc.source_url,
      reference,
    });
  }

  return { references, citations };
}
