export function buildScoredChunks(scoring, allowedChunkIds) {
  const allowed = new Set(allowedChunkIds);
  const scoredMap = new Map();
  for (const entry of scoring) {
    if (!entry || typeof entry !== "object") continue;
    const rawId = String(entry.chunk_id || "").trim();
    if (!rawId) continue;
    if (!allowed.has(rawId)) continue;
    const score = Number(entry.score);
    if (!Number.isFinite(score)) continue;
    const normalizedScore = Math.max(1, Math.min(100, Math.trunc(score)));
    const existing = scoredMap.get(rawId);
    if (!existing || normalizedScore > existing.score) {
      scoredMap.set(rawId, { chunk_id: rawId, score: normalizedScore });
    }
  }
  const scored = Array.from(scoredMap.values());
  scored.sort((a, b) => b.score - a.score);
  return scored;
}
