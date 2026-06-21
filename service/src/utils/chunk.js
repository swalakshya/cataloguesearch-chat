export function cleanChunk(raw) {
  if (!raw || typeof raw !== "object") return null;
  return {
    id: raw.chunk_id || "",
    p: raw.page_number ?? null,
    pp: raw.pdf_page_number ?? null,
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

// Builds a two-section context string for guj-search mode.
// Hindi passages come first, followed by Gujarati passages.
// If either set is empty, its section is omitted.
export function buildMultiLangContext(hindiChunks, gujaratiChunks) {
  const parts = [];
  if (Array.isArray(hindiChunks) && hindiChunks.length) {
    parts.push(`### Hindi Passages\n${buildContext(hindiChunks)}`);
  }
  if (Array.isArray(gujaratiChunks) && gujaratiChunks.length) {
    parts.push(`### Gujarati Passages\n${buildContext(gujaratiChunks)}`);
  }
  return parts.join("\n\n");
}

export function extractChunkIds(chunks) {
  return chunks.map((chunk) => chunk.id).filter(Boolean);
}

/**
 * Build the labelled guided-passages section for Step2 context.
 * Each entry in guidedResults is { guided_filter: {...}, chunks: Chunk[] }.
 * Returns empty string when there are no non-empty guided result sets.
 */
export function buildGuidedContext(guidedResults) {
  if (!Array.isArray(guidedResults) || !guidedResults.length) return "";
  const sections = [];
  for (const { guided_filter, granth, chunks: filterChunks } of guidedResults) {
    if (!Array.isArray(filterChunks) || !filterChunks.length) continue;
    const label = formatGuidedFilter(guided_filter, granth);
    const body = buildContext(filterChunks)
      .split("\n")
      .map((l) => `  ${l}`)
      .join("\n");
    sections.push(`- filter: ${label}\n${body}`);
  }
  if (!sections.length) return "";
  return `### Guided Passages (kb-suggested filters)\n${sections.join("\n")}`;
}

function formatGuidedFilter(f, granth) {
  if (!f || typeof f !== "object") return "(unknown)";
  const parts = [];
  if (f.shastra != null) parts.push(`shastra=${f.shastra}`);
  if (granth != null) parts.push(`granth=${granth}`);
  if (f.gatha != null) parts.push(`gatha=${f.gatha}`);
  if (f.page != null) parts.push(`page=${f.page}`);
  if (f.teeka != null) parts.push(`teeka=${f.teeka}`);
  return parts.length ? parts.join(", ") : "(unknown)";
}
