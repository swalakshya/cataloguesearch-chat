import { getKeywordPrompt, isPromptV2 } from "./prompts.js";
import { KEYWORD_EXTRACTION_SCHEMA, KEYWORD_EXTRACTION_SCHEMA_GUJ_SEARCH } from "../config/keyword_schema.js";
import { formatConversationHistory } from "./conversation_history.js";
import { parseJsonStrict } from "../utils/json.js";
import { estimateTokens } from "../utils/token.js";
import { log } from "../utils/log.js";

const DEVANAGARI_RE = /[ऀ-ॿ]/;
const ALLOWED_KB_SUBWORKFLOW_NAMES = new Set(["direct_retrieval", "search_shastra_for_topics", "search_topic_in_shastra"]);

// If LLM omits jain_keywords/normal_keywords partition, derive from Devanagari presence.
function applyJainPartitionDefaults(parsed) {
  const keywords = parsed.keywords;
  if (!Array.isArray(keywords) || keywords.length === 0) return parsed;
  if (Array.isArray(parsed.jain_keywords) && Array.isArray(parsed.normal_keywords)) return parsed;
  parsed.jain_keywords = keywords.filter((k) => DEVANAGARI_RE.test(k));
  parsed.normal_keywords = keywords.filter((k) => !DEVANAGARI_RE.test(k));
  return parsed;
}

// Normalize direct_retrieval_only to a strict boolean. Default false (= do not
// skip topic match / guided filters) when the LLM omits or nulls the field, so
// behavior is unchanged unless the LLM explicitly opts in.
function applyDirectRetrievalDefault(parsed) {
  parsed.direct_retrieval_only = parsed.direct_retrieval_only === true;
  return parsed;
}

// Remove sub-workflow entries with unrecognised names to prevent downstream errors.
function stripUnknownSubworkflows(parsed) {
  if (!Array.isArray(parsed.kb_subworkflows)) return parsed;
  const before = parsed.kb_subworkflows.length;
  parsed.kb_subworkflows = parsed.kb_subworkflows.filter((sw) => ALLOWED_KB_SUBWORKFLOW_NAMES.has(sw?.name));
  if (parsed.kb_subworkflows.length !== before) {
    log.warn("kb_subworkflows_stripped", { removed: before - parsed.kb_subworkflows.length });
  }
  return parsed;
}

export async function runKeywordExtraction({
  provider,
  question,
  sessionContext,
  requestId,
  modelId,
  gujChunks = false,
  llmCallsCollector,
}) {
  const useV2 = isPromptV2();
  const history = formatConversationHistory(sessionContext?.conversationHistory, {
    includeChunkScores: true,
    includeAnswers: true,
    compact: useV2,
  });
  const prompt = getKeywordPrompt(question, history, { modelId, requestId, gujChunks });
  log.info("keyword_extract_prompt_tokens_estimate", {
    requestId,
    tokens_estimate: estimateTokens(prompt),
  });

  const messages = [
    { role: "system", content: "You are a precise JSON-only keyword extractor and question classifier. This json will be used for a RAG-retrieval from Jainism related Texts." },
    { role: "user", content: prompt },
  ];

  const responseJsonSchema = gujChunks ? KEYWORD_EXTRACTION_SCHEMA_GUJ_SEARCH : KEYWORD_EXTRACTION_SCHEMA;

  const result = await provider.completeJson({
    messages,
    temperature: 0,
    requestId,
    responseJsonSchema,
  });

  const raw = result.text;

  log.verbose("keyword_extract_llm_response", {
    requestId,
    length: raw?.length || 0,
    response: String(raw || ""),
  });
  log.info("keyword_extract_usage", {
    requestId,
    input_tokens: result.usage_normalized?.input_tokens,
    output_tokens: result.usage_normalized?.output_tokens,
    cached_input_tokens: result.usage_normalized?.cached_input_tokens,
  });

  llmCallsCollector?.push({
    step: "keyword_extract",
    provider: provider.name(),
    model: modelId || null,
    provider_response_id: result.provider_response_id,
    model_version: result.model_version,
    usage_raw: result.usage_raw,
    usage_normalized: result.usage_normalized,
  });

  let parsed;
  try {
    parsed = parseJsonStrict(raw);
  } catch (err) {
    log.warn("keyword_extract_parse_failed", { requestId, error: err?.message || String(err), raw: String(raw || "").slice(0, 500) });
    throw err;
  }

  applyJainPartitionDefaults(parsed);
  applyDirectRetrievalDefault(parsed);
  stripUnknownSubworkflows(parsed);

  log.verbose("keyword_extract_parsed", {
    requestId,
    workflow: parsed.workflow,
    jain_keywords: parsed.jain_keywords,
    normal_keywords: parsed.normal_keywords,
    kb_subworkflows_count: parsed.kb_subworkflows?.length ?? 0,
    direct_retrieval_only: parsed.direct_retrieval_only,
  });
  return parsed;
}
