const MAX_REFERENCES = 200;
const MAX_CITATIONS = 200;

export function stripCitations(text) {
  if (!text) return "";
  return text.replace(/cite[^]+/g, "").trim();
}

export function extractReferences(text) {
  const lines = text.split(/\r?\n/).map((line) => line.trim());
  let inRefs = false;
  const references = [];
  const citations = [];
  const answerLines = [];
  const seenRefs = new Set();
  const seenCitations = new Set();
  let sawReferenceLine = false;

  for (const line of lines) {
    if (!line) {
      if (!inRefs) answerLines.push("");
      continue;
    }
    if (normalizeHeading(line) === "references") {
      inRefs = true;
      continue;
    }
    if (inRefs) {
      if (normalizeHeading(line) && normalizeHeading(line) !== "references") {
        break;
      }
      if (!isReferenceLine(line)) {
        if (sawReferenceLine) break;
        continue;
      }
      const ref = normalizeReferenceLine(line);
      if (!ref) continue;
      sawReferenceLine = true;
      if (!seenRefs.has(ref)) {
        references.push(ref);
        seenRefs.add(ref);
        if (references.length >= MAX_REFERENCES) break;
      }
      const citation = parseReferenceLine(ref);
      if (citation) {
        const key = `${citation.granth || ""}|${citation.category || ""}|${citation.page_number || ""}|${citation.file_url || ""}`;
        if (!seenCitations.has(key)) {
          citations.push(citation);
          seenCitations.add(key);
          if (citations.length >= MAX_CITATIONS) break;
        }
      }
    } else {
      answerLines.push(line);
    }
  }

  if (references.length === 0) {
    const fallback = parseReferencesFromLines(lines);
    for (const ref of fallback) {
      if (!seenRefs.has(ref)) {
        references.push(ref);
        seenRefs.add(ref);
        const citation = parseReferenceLine(ref);
        if (citation) {
          const key = `${citation.granth || ""}|${citation.category || ""}|${citation.page_number || ""}|${citation.file_url || ""}`;
          if (!seenCitations.has(key)) {
            citations.push(citation);
            seenCitations.add(key);
          }
        }
      }
      if (references.length >= MAX_REFERENCES || citations.length >= MAX_CITATIONS) break;
    }
  }

  return { answer: answerLines.join("\n").trim(), references, citations };
}

function normalizeHeading(line) {
  const stripped = line.replace(/[#*]/g, "").replace(/:/g, "").trim().toLowerCase();
  if (stripped === "references") return "references";
  if (stripped === "संदर्भ" || stripped === "सन्दर्भ" || stripped === "स्रोत") return "references";
  if (stripped === "answer") return "answer";
  return "";
}

export function isReferenceLine(line) {
  if (!line) return false;
  if (/https?:\/\//i.test(line)) return true;
  if (/file_url/i.test(line)) return true;
  if (/^\s*[-*]\s+/.test(line)) return true;
  if (/^\s*\d+\.\s+/.test(line)) return true;
  return false;
}

export function normalizeReferenceLine(line) {
  return line
    .replace(/^\s*[-*]\s+/, "")
    .replace(/^\s*\d+\.\s+/, "")
    .replace(/\*\*/g, "")
    .trim();
}

function parseReferenceLine(line) {
  if (!line.includes("http")) return null;
  const cleaned = line.replace(/\bfile_url\s*:\s*/i, "").trim();
  if (!cleaned) return null;
  if (cleaned.includes(" / ")) {
    const parts = cleaned.split(" / ").map((p) => p.trim());
    if (parts.length >= 3 && parts[parts.length - 1].startsWith("http")) {
      return {
        granth: stripQuotes(parts[0]),
        category: stripQuotes(parts[1]),
        page_number: parsePage(parts[2]),
        file_url: parts[parts.length - 1],
      };
    }
  }
  const idx = cleaned.indexOf("http");
  const prefix = cleaned.slice(0, idx).trim().replace(/[—-]+$/, "").trim();
  const file_url = cleaned.slice(idx).trim();
  return {
    granth: extractGranth(prefix),
    category: extractCategory(prefix),
    page_number: extractPage(prefix),
    file_url,
  };
}

function parseReferencesFromLines(lines) {
  const refs = [];
  for (const line of lines) {
    if (!isReferenceLine(line)) continue;
    const ref = normalizeReferenceLine(line);
    if (ref) refs.push(ref);
  }
  return refs;
}

function parsePage(text) {
  let lowered = text.toLowerCase().replace(/,/g, " ").trim();
  if (lowered.startsWith("p.")) lowered = lowered.split("p.")[1].trim();
  if (lowered.includes("page")) lowered = lowered.split("page")[1].trim();
  const value = parseInt(lowered.split(/\s+/)[0], 10);
  return Number.isNaN(value) ? undefined : value;
}

function stripQuotes(text) {
  return text.replace(/["“”]/g, "").trim();
}

function extractPage(prefix) {
  const match = prefix.match(/p\.?\s*(\d+)/i) || prefix.match(/page\s*(\d+)/i);
  if (!match) return undefined;
  return Number(match[1]);
}

function extractCategory(prefix) {
  const match = prefix.match(/\(([^)]+)\)/);
  if (!match) return undefined;
  return match[1];
}

function extractGranth(prefix) {
  if (prefix.includes("(")) {
    return prefix.split("(")[0].trim();
  }
  return prefix.trim();
}

export function sanitizeReferences(refs) {
  if (!Array.isArray(refs)) return [];
  const seen = new Set();
  const cleaned = [];
  for (const ref of refs) {
    const value = String(ref || "").trim();
    if (!value) continue;
    if (!isReferenceLine(value)) continue;
    if (seen.has(value)) continue;
    seen.add(value);
    cleaned.push(value);
    if (cleaned.length >= MAX_REFERENCES) break;
  }
  return cleaned;
}

export function sanitizeCitations(citations) {
  if (!Array.isArray(citations)) return [];
  const seen = new Set();
  const cleaned = [];
  for (const citation of citations) {
    if (!citation || typeof citation !== "object") continue;
    if (!citation.file_url) continue;
    const key = `${citation.granth || ""}|${citation.category || ""}|${citation.page_number || ""}|${citation.file_url}`;
    if (seen.has(key)) continue;
    seen.add(key);
    cleaned.push(citation);
    if (cleaned.length >= MAX_CITATIONS) break;
  }
  return cleaned;
}
