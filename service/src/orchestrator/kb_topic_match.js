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
    const ancestors = Array.isArray(topic.ancestors_hi) ? topic.ancestors_hi : [];
    const pathParts = ancestors.length > 0 ? [...ancestors, displayHi] : [displayHi];
    const path = pathParts.join(" / ");

    const sourceUrl = String(topic.source_url || "").trim();
    let idTag = "";
    if (sourceUrl) {
      const id = `KB-T-${citations.length + 1}`;
      citations.push({ id, label: displayHi || topic.topic_natural_key || id, source_url: sourceUrl });
      idTag = `[${id}] `;
    }

    lines.push(`- ${idTag}topic: ${displayHi} (path: ${path})`);

    const firstExtract = Array.isArray(topic.extracts_hi) ? topic.extracts_hi[0] : null;
    if (firstExtract?.text_hi) {
      lines.push(`  extract: ${firstExtract.text_hi}`);
    }

    const refs = Array.isArray(topic.references) && topic.references.length > 0
      ? formatRefs(topic.references)
      : null;
    if (refs) {
      lines.push(`  refs: ${refs}`);
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

function formatRefs(references) {
  return references
    .map((ref) => {
      const parts = [];
      if (ref.shastra_natural_key) parts.push(`shastra=${ref.shastra_natural_key}`);
      if (ref.gatha_number != null) parts.push(`gatha=${ref.gatha_number}`);
      if (ref.teeka_natural_key) parts.push(`teeka=${ref.teeka_natural_key}`);
      if (ref.page_number != null) parts.push(`page=${ref.page_number}`);
      return parts.join(", ");
    })
    .filter(Boolean)
    .join(" | ");
}
