import { getKeywordPrompt, isPromptV2 } from "./prompts.js";
import { KEYWORD_EXTRACTION_SCHEMA, KEYWORD_EXTRACTION_SCHEMA_GUJ_SEARCH } from "../config/keyword_schema.js";
import { formatConversationHistory } from "./conversation_history.js";
import { parseJsonStrict } from "../utils/json.js";
import { estimateTokens } from "../utils/token.js";
import { log } from "../utils/log.js";

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
  log.verbose("keyword_extract_parsed", { requestId, workflow: parsed.workflow });
  return parsed;
}
