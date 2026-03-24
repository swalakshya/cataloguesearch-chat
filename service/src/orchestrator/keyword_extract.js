import { getKeywordPrompt, getWorkflowCatalog } from "./prompts.js";
import { KEYWORD_EXTRACTION_SCHEMA } from "./keyword_schema.js";
import { log } from "../utils/log.js";

export async function runKeywordExtraction({
  provider,
  question,
  sessionContext,
  requestId,
}) {
  const workflowCatalog = getWorkflowCatalog();
  const extraContext = buildExtraContext(sessionContext);
  const prompt = getKeywordPrompt(question, workflowCatalog, extraContext);

  const messages = [
    { role: "system", content: "You are a precise JSON-only extractor." },
    { role: "user", content: prompt },
  ];

  const raw = await provider.completeJson({
    messages,
    temperature: 0,
    requestId,
    responseJsonSchema: KEYWORD_EXTRACTION_SCHEMA,
  });

  log.info("keyword_extract_llm_response", {
    requestId,
    length: raw?.length || 0,
    preview: String(raw || "").slice(0, 500),
  });

  const parsed = parseJsonStrict(raw);
  log.debug("keyword_extract_parsed", { requestId, workflow: parsed.workflow });
  return parsed;
}

function buildExtraContext(sessionContext) {
  if (!sessionContext) return "";
  const parts = [];
  if (sessionContext.previousQuestion) {
    parts.push(`Previous question: ${sessionContext.previousQuestion}`);
  }
  if (Array.isArray(sessionContext.previousChunkIds) && sessionContext.previousChunkIds.length) {
    parts.push(`Previous retrieved chunk_ids: ${sessionContext.previousChunkIds.join(", ")}`);
  }
  return parts.join("\n");
}

function parseJsonStrict(raw) {
  if (!raw) throw new Error("Empty JSON response");
  const trimmed = raw.trim();
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
