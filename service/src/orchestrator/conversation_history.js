export function formatConversationHistory(
  history,
  { includeChunkScores = true, includeAnswers = true, compact = false } = {}
) {
  if (!Array.isArray(history) || history.length === 0) {
    return "[]";
  }
  const normalized = history.map((entry, index) => {
    const base = {
      i: entry?.id || `set_${index + 1}`,
      q: String(entry?.question || "").trim(),
    };
    if (includeAnswers) {
      base.a = String(entry?.answer || "").trim();
    }
    if (includeChunkScores) {
      base.s = Array.isArray(entry?.chunk_scores)
        ? entry.chunk_scores.map((item) => ({
            id: item?.chunk_id,
            v: item?.score,
          }))
        : [];
    }
    return base;
  });
  return compact ? JSON.stringify(normalized) : JSON.stringify(normalized, null, 2);
}
