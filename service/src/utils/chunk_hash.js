export function buildHashedChunks(chunks, session) {
  return chunks.map((chunk) => {
    const hash = getChunkHash(session, chunk.id);
    return { ...chunk, id: hash };
  });
}

export function getChunkHash(session, realId) {
  if (!realId) return "";
  const existing = session.chunkIdReverseMap?.[realId];
  if (existing) return existing;
  const next = `c${(session.chunkIdCounter || 0) + 1}`;
  session.chunkIdCounter = (session.chunkIdCounter || 0) + 1;
  session.chunkIdMap[next] = realId;
  session.chunkIdReverseMap[realId] = next;
  return next;
}

export function mapHashedIdsToReal(ids, session) {
  if (!Array.isArray(ids)) return [];
  return ids.map((hash) => session.chunkIdMap?.[hash]).filter(Boolean);
}
