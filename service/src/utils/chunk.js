export function cleanChunk(raw) {
  if (!raw || typeof raw !== "object") return null;
  return {
    id: raw.chunk_id || "",
    p: raw.page_number ?? null,
    g: raw.granth || "",
    a: raw.author || "",
    t: raw.text_content || "",
  };
}

export function cleanChunks(chunks) {
  if (!Array.isArray(chunks)) return [];
  const cleaned = [];
  const seen = new Set();
  for (const chunk of chunks) {
    const value = cleanChunk(chunk);
    if (!value || !value.id) continue;
    if (seen.has(value.id)) continue;
    seen.add(value.id);
    cleaned.push(value);
  }
  return cleaned;
}

export function buildContext(chunks) {
  if (!chunks.length) return "";
  return chunks
    .map((chunk, idx) => {
      if (chunk && chunk.kind === "metadata") {
        return `Source ${idx + 1}:\n${JSON.stringify(chunk, null, 2)}`;
      }
      return `Source ${idx + 1}:\n${JSON.stringify(chunk, null, 2)}`;
    })
    .join("\n\n");
}

export function extractChunkIds(chunks) {
  return chunks.map((chunk) => chunk.id).filter(Boolean);
}
