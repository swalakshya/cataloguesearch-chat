import { log } from "../utils/log.js";

const DEFAULT_THRESHOLD = 4;
const DEFAULT_TOP_CHUNKS = 1;

function resolveInt(raw, fallback) {
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

export function getHistorySummaryThreshold(env = process.env) {
  return resolveInt(env.LLM_HISTORY_SUMMARY_THRESHOLD, DEFAULT_THRESHOLD);
}

export function getHistorySummaryTopChunks(env = process.env) {
  return resolveInt(env.LLM_HISTORY_SUMMARY_TOP_CHUNKS, DEFAULT_TOP_CHUNKS);
}

export function buildSummaryPrompt(history) {
  const lines = history
    .map(
      (entry) =>
        `Q: ${String(entry?.question || "").trim()}\nA: ${String(entry?.answer || "").trim()}`
    )
    .join("\n\n");
  return lines.trim();
}

export async function compactHistoryIfNeeded({ history, threshold, topChunksPerSet, summarize }) {
  const normalized = Array.isArray(history) ? history : [];
  if (normalized.length < threshold) {
    return { didCompact: false, history: normalized };
  }

  const chunkMap = new Map();
  for (const entry of normalized) {
    const scores = Array.isArray(entry?.chunk_scores) ? entry.chunk_scores.slice() : [];
    scores.sort((a, b) => Number(b?.score || 0) - Number(a?.score || 0));
    const keep = scores.slice(0, topChunksPerSet);
    for (const item of keep) {
      const id = String(item?.chunk_id || "").trim();
      if (!id) continue;
      chunkMap.set(id, { chunk_id: id, score: 100 });
    }
  }

  const summaryText = await summarize(normalized);
  const chunkScores = Array.from(chunkMap.values());
  const chunkIds = chunkScores.map((c) => c.chunk_id);

  const summaryEntry = {
    id: "set_1",
    question: "Conversation summary",
    answer: summaryText,
    chunk_ids: chunkIds,
    chunk_scores: chunkScores,
  };

  log.info("history_summary_applied", {
    originalSets: normalized.length,
    summaryChunks: chunkScores.length,
  });

  return { didCompact: true, history: [summaryEntry] };
}
