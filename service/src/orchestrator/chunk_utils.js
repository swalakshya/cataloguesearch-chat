export function cleanChunk(raw) {
  if (!raw || typeof raw !== "object") return null;
  return {
    file_url: raw.file_url || "",
    chunk_id: raw.chunk_id || "",
    page_number: raw.page_number ?? null,
    gatha: raw.gatha ?? null,
    granth: raw.granth || "",
    category: raw.category || "",
    text_content: raw.text_content || "",
  };
}

export function cleanChunks(chunks) {
  if (!Array.isArray(chunks)) return [];
  const cleaned = [];
  const seen = new Set();
  for (const chunk of chunks) {
    const value = cleanChunk(chunk);
    if (!value || !value.chunk_id) continue;
    if (seen.has(value.chunk_id)) continue;
    seen.add(value.chunk_id);
    cleaned.push(value);
  }
  return cleaned;
}

export function buildContext(chunks) {
  if (!chunks.length) return "";
  return chunks
    .map((chunk, idx) => {
      return `Source ${idx + 1}:\n${JSON.stringify(chunk, null, 2)}`;
    })
    .join("\n\n");
}

export function extractChunkIds(chunks) {
  return chunks.map((chunk) => chunk.chunk_id).filter(Boolean);
}
