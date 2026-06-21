import { log } from "../utils/log.js";

const TOPIC_MATCH_WORKFLOWS = new Set([
  "basic_question_v1",
  "followup_question_v1",
  "advanced_distinct_questions_v1",
  "advanced_nested_questions_v1",
]);

/**
 * Extract all keyword sets from step1 result according to workflow type.
 * Returns an array of string arrays; each inner array is one topicsMatch call.
 */
export function extractKeywordSets(keywordResult) {
  const workflow = keywordResult?.workflow;
  if (!TOPIC_MATCH_WORKFLOWS.has(workflow)) return [];

  const rootKeywords = Array.isArray(keywordResult.keywords) && keywordResult.keywords.length > 0
    ? keywordResult.keywords
    : null;

  if (workflow === "basic_question_v1") {
    return rootKeywords ? [rootKeywords] : [];
  }

  if (workflow === "followup_question_v1") {
    const sets = [];
    if (rootKeywords) sets.push(rootKeywords);
    for (const fk of (keywordResult.followup_keywords || [])) {
      if (Array.isArray(fk?.keywords) && fk.keywords.length > 0) sets.push(fk.keywords);
    }
    return sets;
  }

  if (workflow === "advanced_distinct_questions_v1") {
    const sets = [];
    for (const q of (keywordResult.queries || [])) {
      if (Array.isArray(q?.keywords) && q.keywords.length > 0) sets.push(q.keywords);
    }
    return sets;
  }

  if (workflow === "advanced_nested_questions_v1") {
    const sets = [];
    if (Array.isArray(keywordResult.main_query?.keywords) && keywordResult.main_query.keywords.length > 0) {
      sets.push(keywordResult.main_query.keywords);
    }
    for (const sq of (keywordResult.sub_queries || [])) {
      if (Array.isArray(sq?.keywords) && sq.keywords.length > 0) sets.push(sq.keywords);
    }
    return sets;
  }

  return [];
}

/**
 * Run topic-match (anchor → expand) for all keyword sets extracted from step1 result.
 * All sets run in parallel; within each set the two stages are sequential.
 * Never throws — returns [] on total failure.
 */
export async function runKbTopicMatch({ keywordResult, kbApiClient, requestId }) {
  const keywordSets = extractKeywordSets(keywordResult);

  if (keywordSets.length === 0) {
    log.verbose("kb_topic_match_skip", { requestId, reason: "no_keyword_sets", workflow: keywordResult?.workflow });
    return [];
  }

  const topicMatchLimit = Number(process.env.KB_TOPIC_MATCH_LIMIT || 5);
  const topicNeighborsLimit = Number(process.env.KB_TOPIC_NEIGHBORS_LIMIT || 10);
  const mergeLimit = Number(process.env.KB_TOPIC_MERGE_LIMIT || 5);

  log.info("kb_topic_match_start", {
    requestId,
    workflow: keywordResult.workflow,
    keywordSetCount: keywordSets.length,
  });

  const setResults = await Promise.all(
    keywordSets.map((keywords) =>
      runSingleKeywordSet({ keywords, kbApiClient, requestId, topicMatchLimit, topicNeighborsLimit })
    )
  );

  // Deduplicate anchors across keyword sets (highest score wins per natural key)
  const allAnchorsMap = new Map();
  const allNeighborsByAnchor = {};

  for (const { anchors, neighborsByAnchor } of setResults) {
    for (const anchor of anchors) {
      if (!anchor.topic_natural_key) continue;
      const existing = allAnchorsMap.get(anchor.topic_natural_key);
      if (!existing || (anchor.score ?? 0) > (existing.score ?? 0)) {
        allAnchorsMap.set(anchor.topic_natural_key, anchor);
      }
    }
    Object.assign(allNeighborsByAnchor, neighborsByAnchor);
  }

  const uniqueAnchors = Array.from(allAnchorsMap.values());
  const withNeighbors = attachNeighbors(uniqueAnchors, allNeighborsByAnchor);
  const merged = withNeighbors
    .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
    .slice(0, mergeLimit);

  log.info("kb_topic_match_complete", {
    requestId,
    totalAnchors: uniqueAnchors.length,
    merged: merged.length,
  });

  return merged;
}

async function runSingleKeywordSet({ keywords, kbApiClient, requestId, topicMatchLimit, topicNeighborsLimit }) {
  // Stage 1: anchor via topics_match
  let anchors = [];
  try {
    const result = await kbApiClient.topicsMatch(
      { keywords, limit: topicMatchLimit, includeExtracts: true, includeReferences: true },
      requestId
    );
    anchors = Array.isArray(result) ? result : [];
  } catch (err) {
    log.warn("kb_topics_match_call_failed", {
      requestId,
      keywords,
      error: err?.message || String(err),
    });
    return { anchors: [], neighborsByAnchor: {} };
  }

  if (anchors.length === 0) {
    return { anchors: [], neighborsByAnchor: {} };
  }

  // Stage 2: expand via topic_neighbors (best-effort — failure degrades to bare anchors)
  let neighborsByAnchor = {};
  try {
    const naturalKeys = anchors.map((a) => a.topic_natural_key).filter(Boolean);
    neighborsByAnchor = await kbApiClient.topicNeighbors(
      { topicNaturalKeys: naturalKeys, maxNeighborsPerTopic: topicNeighborsLimit, includeExtracts: false, includeReferences: false },
      requestId
    );
  } catch (err) {
    log.warn("kb_topic_neighbors_call_failed", {
      requestId,
      keywords,
      error: err?.message || String(err),
    });
  }

  return { anchors, neighborsByAnchor };
}

/**
 * Attach neighbors from stage-2 response to anchors by topic_natural_key.
 * Pure function — does not call any external services.
 */
export function attachNeighbors(anchors, neighborsByAnchor) {
  const nbMap = (neighborsByAnchor && typeof neighborsByAnchor === "object" && !Array.isArray(neighborsByAnchor))
    ? neighborsByAnchor
    : {};

  return anchors.map((anchor) => {
    const nb = nbMap[anchor.topic_natural_key];
    if (nb) return { ...anchor, neighbors: nb };
    return anchor;
  });
}

/**
 * Format merged topics into a context section for the Step2 prompt.
 *
 * Each topic that carries a jainkosh `source_url` is tagged with a stable citable
 * id (`KB-T-<n>`) so the Step2 LLM can cite it via the `scoring` array.
 *
 * Returns `{ text, citations }`. `text` is "" when there are no topics; `citations`
 * is `[{ id, label, source_url }]` for the tagged topics.
 */
export function formatKbTopicsContext(mergedTopics) {
  if (!Array.isArray(mergedTopics) || mergedTopics.length === 0) {
    return { text: "", citations: [] };
  }

  const lines = ["### KB Topics (Hindi extracts, closest first)"];
  const citations = [];

  for (const topic of mergedTopics) {
    const displayHi = topic.display_text_hi || topic.topic_natural_key || "";

    const sourceUrl = String(topic.source_url || "").trim();
    let idTag = "";
    if (sourceUrl) {
      const id = `KB-T-${citations.length + 1}`;
      citations.push({ id, label: displayHi || topic.topic_natural_key || id, source_url: sourceUrl });
      idTag = `[${id}] `;
    }

    lines.push(`- ${idTag}topic: ${displayHi}`);

    // Render every Hindi extract, each with its own main reference (the first
    // reference the definition modal would surface for that extract block).
    const extracts = Array.isArray(topic.extracts_hi) ? topic.extracts_hi : [];
    for (const extract of extracts) {
      if (!extract?.text_hi) continue;
      lines.push(`  extract: ${extract.text_hi}`);
      const ref = formatMainRef(extract.main_reference);
      if (ref) lines.push(`  ref: ${ref}`);
    }

    const relatedTopics = topic.neighbors?.related_topics;
    if (Array.isArray(relatedTopics) && relatedTopics.length > 0) {
      const relatedLine = relatedTopics
        .map((rt) => rt.display_text_hi || rt.topic_natural_key || "")
        .filter(Boolean)
        .join(", ");
      if (relatedLine) lines.push(`  related: ${relatedLine}`);
    }
  }

  return { text: lines.join("\n"), citations };
}

// Reference fields that are publication-locator noise (printed volume / page /
// line), excluded from the Step2 context — same fields the definition modal
// keeps out of its ref label.
const EXCLUDED_REF_FIELDS = new Set(["पुस्तक", "पृष्ठ", "पंक्ति"]);

/**
 * Strip a shastra/teeka name prepended to a resolved-field name so the field
 * reads cleanly (e.g. "धवलासूत्र" → "सूत्र" for shastra "धवला",
 * "श्लोकवार्तिकवार्तिक" → "वार्तिक"). Returns the field unchanged when no
 * source prefix matches.
 */
function stripSourcePrefix(field, shastra, teeka) {
  for (const prefix of [shastra, teeka]) {
    if (prefix && field.length > prefix.length && field.startsWith(prefix)) {
      return field.slice(prefix.length);
    }
  }
  return field;
}

/**
 * Format a single extract's main reference into a compact label. Includes the
 * shastra (and teeka when present) plus all resolved_fields except the
 * publication-locator noise, with any shastra/teeka prefix stripped from field
 * names. Returns null when there is nothing to show.
 */
function formatMainRef(mainReference) {
  if (!mainReference) return null;
  const shastra = String(mainReference.shastra_name || "").trim();
  const teeka = String(mainReference.teeka_name || "").trim();
  const parts = [];
  if (shastra) parts.push(`shastra=${shastra}`);
  if (teeka) parts.push(`teeka=${teeka}`);
  for (const f of (mainReference.resolved_fields || [])) {
    if (!f || f.field == null || f.value == null) continue;
    if (EXCLUDED_REF_FIELDS.has(f.field)) continue;
    const name = stripSourcePrefix(String(f.field), shastra, teeka);
    parts.push(`${name}=${f.value}`);
  }
  return parts.length > 0 ? parts.join(", ") : null;
}
