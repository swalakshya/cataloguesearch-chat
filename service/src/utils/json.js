export function parseJsonStrict(raw) {
  if (!raw) throw new Error("Empty JSON response");
  const trimmed = String(raw).trim();
  try {
    return JSON.parse(trimmed);
  } catch (e1) {
    // Gemini sometimes appends text after the closing }. The error position
    // tells us exactly where the valid JSON ends — slice there and retry.
    const posMatch = String(e1?.message || "").match(/position (\d+)/);
    if (posMatch) {
      try {
        return JSON.parse(trimmed.slice(0, Number(posMatch[1])));
      } catch {}
    }
    const extracted = extractJsonBlock(trimmed);
    try {
      return JSON.parse(extracted);
    } catch {
      const normalized = normalizeJsonLike(extracted);
      return JSON.parse(normalized);
    }
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

export function sanitizeJsonStringControls(raw) {
  let inString = false;
  let escaped = false;
  let out = "";
  for (let i = 0; i < raw.length; i += 1) {
    const ch = raw[i];
    if (escaped) {
      out += ch;
      escaped = false;
      continue;
    }
    if (ch === "\\") {
      out += ch;
      escaped = true;
      continue;
    }
    if (ch === "\"") {
      out += ch;
      inString = !inString;
      continue;
    }
    if (inString) {
      const code = ch.charCodeAt(0);
      if (code < 0x20) {
        if (ch === "\n") out += "\\n";
        else if (ch === "\r") out += "\\r";
        else if (ch === "\t") out += "\\t";
        else out += `\\u${code.toString(16).padStart(4, "0")}`;
        continue;
      }
    }
    out += ch;
  }
  return out;
}

export function normalizeJsonLike(raw) {
  if (!raw) return raw;
  const text = String(raw)
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/```(?:json)?/gi, "")
    .replace(/```/g, "")
    .trim();
  return sanitizeJsonStringControls(text);
}

export function extractAnswerFallback(raw) {
  const text = String(raw || "");
  const match = text.match(/"answer"\s*:\s*"((?:\\.|[^"\\])*)"/s);
  if (!match) return text;
  try {
    return JSON.parse(`"${match[1]}"`);
  } catch {
    return match[1];
  }
}
