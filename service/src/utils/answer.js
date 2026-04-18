const MAX_REFERENCES = 200;
const MAX_CITATIONS = 200;

export function stripCitations(text) {
  if (!text) return "";
  return text.replace(/cite[^]+/g, "").trim();
}

export function normalizeAnswerTextForParsing(text) {
  if (!text) return "";
  return String(text)
    .replace(/\\r\\n/g, "\n")
    .replace(/\\n/g, "\n")
    .replace(/\\t/g, "\t")
    .replace(/\\<sub\\>/gi, "<sub>")
    .replace(/\\<\/sub\\>/gi, "</sub>")
    .replace(/&lt;sub&gt;/gi, "<sub>")
    .replace(/&lt;\/sub&gt;/gi, "</sub>")
    .replace(/\u2028/g, "\n")
    .replace(/\u2029/g, "\n")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n");
}

export function cleanAnswerText({ text, language, script }) {
  if (!text) return "";
  let output = String(text);

  // Convert **word** to *word*
  output = output.replace(/\*\*([^*]+)\*\*/g, "*$1*");

  // Remove chunk id markers like (c13) or (c1, c6, c15)
  output = output.replace(/\(\s*c\d+(?:\s*,\s*c\d+)*\s*\)/gi, "");

  if (String(language || "").toLowerCase() === "hi") {
    const normalizedScript = String(script || "").toLowerCase();
    if (normalizedScript === "latin" || normalizedScript === "devanagari") {
      output = output
        .replace(/Summary/g, "सारांश")
        .replace(/References/g, "संदर्भ")
        .replace(
          /If you want I can answer this in detail or I can also answer/g,
          "अगर आप चाहें तो मैं और विस्तार से उत्तर दे सकता हूँ अथवा मैं इन सवालों के जवाब भी दे सकता हूँ"
        )
        .replace(
          /This question cannot be answered at this time due to insufficient scriptural citations or multiple interpretations\. To avoid incorrect guidance, we recommend consulting a knowledgeable acharya or scholar or please try rephrasing the question\./g,
          "अपर्याप्त ग्रंथ उद्धरणों के कारण या अनेक व्याख्याओं के कारण इस समय प्रश्न का उत्तर देना संभव नहीं है। गलत मार्गदर्शन से बचने के लिए, हम किसी ज्ञानी आचार्य या विद्वान से परामर्श करने की सलाह देते हैं अथवा प्रश्न को अलग शब्दों में कहने का प्रयास करें।।"
        )
        .replace(
          /This question cannot be answered at this time due to insufficient scriptural citations\. To avoid incorrect guidance, we recommend consulting a knowledgeable acharya or scholar\./g,
          "अपर्याप्त ग्रंथ उद्धरणों के कारण इस समय प्रश्न का उत्तर देना संभव नहीं है। गलत मार्गदर्शन से बचने के लिए, हम किसी ज्ञानी आचार्य या विद्वान से परामर्श करने की सलाह देते हैं।"
        );
    }
  }

  return output;
}

export function normalizeAnswerTextForOutput(text) {
  if (!text) return "";
  return String(text);
}

export function normalizeReferencesInAnswer(text) {
  if (!text) return "";
  const lines = String(text).split(/\r?\n/);
  let inRefs = false;
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i].trim();
    if (!line) {
      continue;
    }
    const heading = normalizeHeading(line);
    if (heading === "references") {
      inRefs = true;
      continue;
    }
    if (inRefs) {
      if (heading && heading !== "references") {
        break;
      }
      if (!isReferenceLine(line)) {
        continue;
      }
      lines[i] = appendPageSuffixToUrl(lines[i]);
    }
  }
  return lines.join("\n");
}

export function appendReferencesSection(answer, references, language = "") {
  const body = String(answer || "").trim();
  const safeReferences = Array.isArray(references)
    ? references.map((ref) => String(ref || "").trim()).filter(Boolean)
    : [];
  if (!safeReferences.length) return body;
  const heading = String(language || "").toLowerCase() === "hi" ? "संदर्भ" : "References";
  const lines = [body, heading, ...safeReferences.map((ref, index) => `${index + 1}. ${ref}`)].filter(Boolean);
  return lines.join("\n\n").trim();
}

export function sanitizeFollowUpQuestions(questions, maxItems = 3) {
  if (!Array.isArray(questions)) return [];
  const seen = new Set();
  const cleaned = [];
  for (const question of questions) {
    const value = String(question || "").trim();
    if (!value) continue;
    if (seen.has(value)) continue;
    seen.add(value);
    cleaned.push(value);
    if (cleaned.length >= maxItems) break;
  }
  return cleaned;
}

export function buildStructuredReferencesFromMetadata({
  scoredChunks,
  parsedReferencesCount,
  hashToRealId,
  metadataByRealId,
  language = "",
} = {}) {
  const hashMap = hashToRealId && typeof hashToRealId === "object" ? hashToRealId : {};
  const metadataMap = metadataByRealId && typeof metadataByRealId === "object" ? metadataByRealId : {};
  const scored = Array.isArray(scoredChunks) ? scoredChunks : [];
  const targetCount = resolveReferenceCount(parsedReferencesCount, scored.length);
  if (targetCount === 0) {
    return { references: [], citations: [] };
  }
  const references = [];
  const citations = [];
  const seen = new Set();

  for (const entry of scored) {
    const hash = String(entry?.chunk_id || "").trim();
    if (!hash) continue;
    const realId = hashMap[hash] || hash;
    const metadata = metadataMap[realId];
    if (!metadata) continue;
    const reference = formatReferenceFromMetadata(metadata, { language });
    const citation = buildCitationFromMetadata(metadata, reference);
    if (!reference || !citation?.file_url) continue;
    const key = `${citation.category || ""}|${citation.granth || ""}|${citation.page_number || ""}|${citation.file_url}`;
    if (seen.has(key)) continue;
    seen.add(key);
    references.push(reference);
    citations.push(citation);
    if (references.length >= targetCount) break;
  }

  return { references, citations };
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
  const normalized = line
    .replace(/^\s*[-*]\s+/, "")
    .replace(/^\s*\d+\.\s+/, "")
    .replace(/\*\*/g, "")
    .replace(/\bgranth\s*:\s*/gi, "")
    .replace(/\bpage_number\s*:\s*/gi, "")
    .trim();
  return appendPageSuffixToUrl(normalized);
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

function appendPageSuffixToUrl(line) {
  if (!line || !line.includes("http")) return line;
  const idx = line.indexOf("http");
  const prefix = line.slice(0, idx).trimEnd();
  const page = extractPage(prefix);
  if (!page) return line;
  const url = line.slice(idx).trim();
  if (url.endsWith(`/${page}`)) return line;
  const spacer = prefix ? " " : "";
  return `${prefix}${spacer}${url}/${page}`;
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

function formatReferenceFromMetadata(metadata, { language = "" } = {}) {
  if (!metadata || typeof metadata !== "object") return "";
  const category = String(metadata.category || "").trim();
  if (category === "Pravachan") {
    return formatPravachanReference(metadata, { language });
  }
  return formatGranthReference(metadata, { language });
}

function formatPravachanReference(metadata, { language = "" } = {}) {
  const isHindi = String(language || "").toLowerCase() === "hi";
  const granth = String(metadata.granth || "").trim();
  const pravachankar = String(metadata.pravachankar || "").trim();
  const head = pravachankar
    ? isHindi
      ? `${pravachankar} द्वारा "${granth} प्रवचन"`
      : `"${granth} Pravachan" by ${pravachankar}`
    : isHindi
      ? `"${granth} प्रवचन"`
      : `"${granth} Pravachan"`;
  const segments = [
    head,
    formatLabeledValue({ labelHi: "क्रमांक", labelEn: "Number", value: metadata.pravachan_number, isHindi }),
    formatLabeledValue({ labelHi: "Series Number", labelEn: "Series Number", value: metadata.series_number, isHindi }),
    formatLabeledValue({ labelHi: "Volume", labelEn: "Volume", value: metadata.volume, isHindi }),
    ...formatLocatorSegments(metadata, { isHindi }),
    formatLabeledValue({ labelHi: "पृष्ठ", labelEn: "Page", value: metadata.page_number, isHindi }),
    formatLabeledValue({ labelHi: "दिनांक", labelEn: "Date", value: formatDateValue(metadata.date), isHindi }),
  ].filter(Boolean);
  const fileUrl = withPageSuffix(metadata.file_url, metadata.page_number);
  return [segments.join(", "), fileUrl].filter(Boolean).join(", ").trim();
}

function formatGranthReference(metadata, { language = "" } = {}) {
  const isHindi = String(language || "").toLowerCase() === "hi";
  const granth = String(metadata.granth || "").trim();
  const segments = [
    granth,
    ...formatLocatorSegments(metadata, { isHindi }),
    formatLabeledValue({ labelHi: "पृष्ठ", labelEn: "Page", value: metadata.page_number, isHindi }),
  ].filter(Boolean);
  const fileUrl = withPageSuffix(metadata.file_url, metadata.page_number);
  return [segments.join(", "), fileUrl].filter(Boolean).join(", ").trim();
}

function formatLocatorSegments(metadata, { isHindi }) {
  return [
    formatLabeledValue({ labelHi: "गाथा", labelEn: "Gatha", value: metadata.gatha, isHindi }),
    formatLabeledValue({ labelHi: "कलश", labelEn: "Kalash", value: metadata.kalash, isHindi }),
    formatLabeledValue({ labelHi: "श्लोक", labelEn: "Shlok", value: metadata.shlok, isHindi }),
    formatLabeledValue({ labelHi: "दोहा", labelEn: "Dohra", value: metadata.dohra, isHindi }),
  ].filter(Boolean);
}

function formatLabeledValue({ labelHi, labelEn, value, isHindi }) {
  if (value === undefined || value === null || String(value).trim() === "") return "";
  const label = isHindi ? labelHi : labelEn;
  return `${label} ${String(value).trim()}`;
}

function formatDateValue(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  // Backend contract is expected to be YYYY-MM-DD; preserve unknown formats verbatim.
  const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return raw;
  return `${match[3]}-${match[2]}-${match[1]}`;
}

function withPageSuffix(fileUrl, pageNumber) {
  const url = String(fileUrl || "").trim();
  const page = Number(pageNumber);
  if (!url) return "";
  if (!Number.isFinite(page) || page <= 0) return url;
  return url.endsWith(`/${page}`) ? url : `${url}/${page}`;
}

function buildCitationFromMetadata(metadata, reference) {
  if (!metadata || typeof metadata !== "object") return null;
  return {
    chunk_id: String(metadata.chunk_id || "").trim() || undefined,
    granth: String(metadata.granth || "").trim() || extractGranth(String(reference || "").trim()),
    author: String(metadata.author || "").trim() || undefined,
    category: String(metadata.category || "").trim() || undefined,
    page_number: toPositiveNumber(metadata.page_number),
    file_url: withPageSuffix(metadata.file_url, metadata.page_number),
    pravachankar: String(metadata.pravachankar || "").trim() || undefined,
    date: formatDateValue(metadata.date) || undefined,
    pravachan_number: String(metadata.pravachan_number || "").trim() || undefined,
    series: String(metadata.series || "").trim() || undefined,
    series_number: String(metadata.series_number || "").trim() || undefined,
    volume: toPositiveNumber(metadata.volume),
    gatha: String(metadata.gatha || "").trim() || undefined,
    kalash: String(metadata.kalash || "").trim() || undefined,
    shlok: String(metadata.shlok || "").trim() || undefined,
    dohra: String(metadata.dohra || "").trim() || undefined,
    reference,
  };
}

function toPositiveNumber(value) {
  const num = Number(value);
  return Number.isFinite(num) && num > 0 ? num : undefined;
}

function resolveReferenceCount(parsedReferencesCount, scoredLength) {
  const parsedCount =
    parsedReferencesCount === undefined || parsedReferencesCount === null || parsedReferencesCount === ""
      ? undefined
      : Number(parsedReferencesCount);
  if (Number.isFinite(parsedCount)) {
    return Math.max(0, Math.min(MAX_REFERENCES, Math.trunc(parsedCount)));
  }
  return Math.max(1, Math.min(MAX_REFERENCES, Math.min(Number(scoredLength) || 0, 2)));
}

function extractPage(prefix) {
  const match =
    prefix.match(/p\.?\s*(\d+)/i) ||
    prefix.match(/page\s*(\d+)/i) ||
    prefix.match(/पृष्ठ\s*(\d+)/);
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
    cleaned.push({
      chunk_id: citation.chunk_id || undefined,
      granth: citation.granth || undefined,
      author: citation.author || undefined,
      category: citation.category || undefined,
      page_number: citation.page_number,
      file_url: citation.file_url,
      pravachankar: citation.pravachankar || undefined,
      date: citation.date || undefined,
      pravachan_number: citation.pravachan_number || undefined,
      series: citation.series || undefined,
      series_number: citation.series_number || undefined,
      volume: citation.volume,
      gatha: citation.gatha || undefined,
      kalash: citation.kalash || undefined,
      shlok: citation.shlok || undefined,
      dohra: citation.dohra || undefined,
      reference: citation.reference || undefined,
    });
    if (cleaned.length >= MAX_CITATIONS) break;
  }
  return cleaned;
}
