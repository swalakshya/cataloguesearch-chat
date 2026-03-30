export function parseJsonStrict(raw) {
  if (!raw) throw new Error("Empty JSON response");
  const trimmed = String(raw).trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    const extracted = extractJsonBlock(trimmed);
    return JSON.parse(extracted);
  }
}

function extractJsonBlock(text) {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) {
    throw new Error("Unable to locate JSON object in response");
  }
  return text.slice(start, end + 1);
}
