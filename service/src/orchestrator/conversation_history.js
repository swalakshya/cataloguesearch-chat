export function formatConversationHistory(history) {
  if (!Array.isArray(history) || history.length === 0) {
    return "[]";
  }
  const normalized = history.map((entry, index) => ({
    id: entry?.id || `set_${index + 1}`,
    question: String(entry?.question || "").trim(),
    answer: String(entry?.answer || "").trim(),
    chunk_ids: Array.isArray(entry?.chunk_ids) ? entry.chunk_ids : [],
    chunk_scores: Array.isArray(entry?.chunk_scores) ? entry.chunk_scores : [],
  }));
  return JSON.stringify(normalized, null, 2);
}
