import { log } from "../utils/log.js";

const KNOWN_SUBWORKFLOW_NAMES = new Set([
  "direct_retrieval",
  "search_shastra_for_topics",
  "search_topic_in_shastra",
]);

async function canonicalizeShastra(kbApiClient, shastra, requestId) {
  const results = await kbApiClient.shastras({ q: shastra, fuzzy: true, limit: 1 }, requestId);
  const match = Array.isArray(results) ? results[0] : null;
  return match?.natural_key || shastra;
}

// direct_retrieval returns the mool verse + commentary layers. The (Sanskrit)
// teeka is only fetched/projected when the user explicitly asks for it
// (include_teeka); the LLM no longer selects individual fields otherwise.
// Projection order doubles as the context render order: teeka (Sanskrit
// commentary) is placed ahead of bhaavarth when present.
const CONTENT_FIELDS = ["prakrit", "sanskrit", "anyavaarth", "teeka", "bhaavarth"];

// Display labels for the context render; fields not listed render under their key.
const CONTENT_FIELD_LABELS = { teeka: "sanskrit teeka", bhaavarth: "teeka-bhaavarth (hindi)" };

async function dispatchDirectRetrieval(entry, kbApiClient, requestId) {
  const { shastra, gatha_number, adhikaar_number } = entry;
  const includeTeeka = entry.include_teeka === true;
  if (!shastra || gatha_number == null) {
    log.warn("kb_subworkflow_invalid_entry", { requestId, name: "direct_retrieval", missing: !shastra ? "shastra" : "gatha_number" });
    return null;
  }

  const naturalKey = await canonicalizeShastra(kbApiClient, shastra, requestId);
  const gathaData = await kbApiClient.gathaDetail(
    { shastra: naturalKey, number: gatha_number, adhikaar: adhikaar_number ?? null, includeTeeka },
    requestId
  );

  const projected = {};
  for (const field of CONTENT_FIELDS) {
    // teeka is only surfaced when explicitly requested, even if the API returns it.
    if (field === "teeka" && !includeTeeka) continue;
    if (gathaData != null && gathaData[field] != null && gathaData[field] !== "") {
      projected[field] = gathaData[field];
    }
  }

  log.info("kb_subworkflow_direct_retrieval_complete", { requestId, shastra: naturalKey, gatha_number, adhikaar_number: adhikaar_number ?? null, includeTeeka, fields: Object.keys(projected) });
  return { name: "direct_retrieval", shastra: naturalKey, gatha_number, adhikaar_number: adhikaar_number ?? null, data: projected };
}

async function dispatchSearchTopicInShastra(entry, kbApiClient, requestId) {
  const { shastra, gatha_number } = entry;
  if (!shastra) {
    log.warn("kb_subworkflow_invalid_entry", { requestId, name: "search_topic_in_shastra", missing: "shastra" });
    return null;
  }

  const limit = Number(process.env.KB_TOPICS_IN_SHASTRA_LIMIT || 25);
  const naturalKey = await canonicalizeShastra(kbApiClient, shastra, requestId);
  const topics = await kbApiClient.topicsInShastra(
    { shastra: naturalKey, gathaNumber: gatha_number ?? null, limit },
    requestId
  );

  log.info("kb_subworkflow_topics_in_shastra_complete", { requestId, shastra: naturalKey, gatha_number: gatha_number ?? null, topicsCount: Array.isArray(topics) ? topics.length : 0 });
  return {
    name: "search_topic_in_shastra",
    shastra: naturalKey,
    gatha_number: gatha_number ?? null,
    topics: Array.isArray(topics) ? topics : [],
  };
}

async function dispatchSearchShastrasForTopics(entry, kbApiClient, requestId) {
  // Schema uses `topic` field (single string) for the natural key or keyword.
  const { topic } = entry;
  if (!topic) {
    log.warn("kb_subworkflow_invalid_entry", { requestId, name: "search_shastra_for_topics", missing: "topic" });
    return null;
  }

  // Resolve canonical natural_key via topicsMatch if topic looks like a display name / keyword
  let topicNaturalKey = topic;
  try {
    const matchResults = await kbApiClient.topicsMatch({ keywords: [topic], limit: 1 }, requestId);
    if (Array.isArray(matchResults) && matchResults.length > 0 && matchResults[0].topic_natural_key) {
      topicNaturalKey = matchResults[0].topic_natural_key;
    }
  } catch (err) {
    log.warn("kb_subworkflow_topic_resolve_failed", { requestId, topic, error: err?.message || String(err) });
  }

  const limitShastras = Number(process.env.KB_SHASTRAS_FOR_TOPIC_LIMIT || 10);
  const limitGathasPerShastra = Number(process.env.KB_GATHAS_PER_SHASTRA_LIMIT || 10);
  const shastras = await kbApiClient.shastrasForTopic(
    { topicNaturalKey, limitShastras, limitGathasPerShastra },
    requestId
  );

  log.info("kb_subworkflow_shastras_for_topic_complete", { requestId, topicNaturalKey, shastraCount: Array.isArray(shastras) ? shastras.length : 0 });
  return {
    name: "search_shastra_for_topics",
    topic_natural_key: topicNaturalKey,
    shastras: Array.isArray(shastras) ? shastras : [],
  };
}

const DISPATCH_TABLE = {
  direct_retrieval: dispatchDirectRetrieval,
  search_topic_in_shastra: dispatchSearchTopicInShastra,
  search_shastra_for_topics: dispatchSearchShastrasForTopics,
};

export async function runKbSubworkflows(kbSubworkflows, kbApiClient, requestId) {
  if (!kbApiClient || !Array.isArray(kbSubworkflows) || kbSubworkflows.length === 0) {
    return [];
  }

  const maxSubworkflows = Number(process.env.KB_SUBWORKFLOWS_MAX || 4);
  const timeoutMs = Number(process.env.KB_SUBWORKFLOW_TIMEOUT_MS || 10000);

  const entries = kbSubworkflows
    .filter((e) => e && KNOWN_SUBWORKFLOW_NAMES.has(e.name))
    .slice(0, maxSubworkflows);

  if (entries.length === 0) return [];

  log.info("kb_subworkflows_start", { requestId, count: entries.length, names: entries.map((e) => e.name) });

  const results = await Promise.all(
    entries.map(async (entry) => {
      const dispatch = DISPATCH_TABLE[entry.name];
      if (!dispatch) {
        log.warn("kb_subworkflow_unknown", { requestId, name: entry.name });
        return null;
      }

      let timeoutHandle;
      const timeoutPromise = new Promise((_, reject) => {
        timeoutHandle = setTimeout(() => reject(new Error("kb_subworkflow_timeout")), timeoutMs);
      });

      try {
        const result = await Promise.race([dispatch(entry, kbApiClient, requestId), timeoutPromise]);
        clearTimeout(timeoutHandle);
        return result;
      } catch (err) {
        clearTimeout(timeoutHandle);
        const isTimeout = err?.message === "kb_subworkflow_timeout";
        log.warn("kb_subworkflow_failed", {
          requestId,
          name: entry.name,
          timeout: isTimeout,
          error: err?.message || String(err),
        });
        return null;
      }
    })
  );

  const successful = results.filter(Boolean);
  log.info("kb_subworkflows_complete", { requestId, total: entries.length, successful: successful.length });
  return successful;
}

export function formatKbSubworkflowsContext(subworkflowResults) {
  if (!Array.isArray(subworkflowResults) || subworkflowResults.length === 0) return "";

  const lines = ["### KB Sub-workflow Results"];

  for (const result of subworkflowResults) {
    if (!result) continue;

    if (result.name === "direct_retrieval") {
      const adhikaarLabel = result.adhikaar_number != null ? `adhikaar ${result.adhikaar_number} ` : "";
      lines.push(`\n[direct_retrieval] ${result.shastra} ${adhikaarLabel}gatha ${result.gatha_number}:`);
      for (const [field, value] of Object.entries(result.data || {})) {
        lines.push(`  ${CONTENT_FIELD_LABELS[field] || field}: ${value}`);
      }
    } else if (result.name === "search_topic_in_shastra") {
      const gathaLabel = result.gatha_number != null ? ` gatha ${result.gatha_number}` : "";
      lines.push(`\n[search_topic_in_shastra] ${result.shastra}${gathaLabel} topics:`);
      for (const topic of result.topics || []) {
        const key = topic.topic_natural_key || topic.name || String(topic);
        const count = topic.mention_count != null ? ` (${topic.mention_count})` : "";
        lines.push(`  - ${key}${count}`);
      }
    } else if (result.name === "search_shastra_for_topics") {
      lines.push(`\n[search_shastra_for_topics] topic = ${result.topic_natural_key}:`);
      for (const shastraEntry of result.shastras || []) {
        // Live query-service shape: { shastra_natural_key, name_hi, total_mentions,
        // gathas: [{ number, page_number }] }. Fall back to legacy field names.
        const name =
          shastraEntry.name_hi ||
          shastraEntry.shastra_natural_key ||
          shastraEntry.shastra ||
          shastraEntry.natural_key ||
          shastraEntry.name ||
          String(shastraEntry);
        const gathaNumbers = (Array.isArray(shastraEntry.gathas) ? shastraEntry.gathas : [])
          .map((g) => (g != null && typeof g === "object" ? g.number : g))
          .filter((n) => n != null && n !== 0);
        const gathas = gathaNumbers.length > 0 ? `gathas ${gathaNumbers.join(", ")}` : "";
        lines.push(`  - ${name}${gathas ? ": " + gathas : ""}`);
      }
    }
  }

  return lines.join("\n");
}
