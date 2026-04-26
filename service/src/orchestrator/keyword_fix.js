import { getKeywordFixPrompt } from "./prompts.js";
import { KEYWORD_EXTRACTION_SCHEMA, KEYWORD_EXTRACTION_SCHEMA_GUJ_SEARCH } from "../config/keyword_schema.js";
import { parseJsonStrict } from "../utils/json.js";
import { estimateTokens } from "../utils/token.js";
import { log } from "../utils/log.js";

export async function runKeywordFix({ provider, question, step1Json, requestId, modelId, gujChunks = false, llmCallsCollector }) {
  const prompt = getKeywordFixPrompt(question, step1Json, { modelId, requestId, gujChunks });
  log.info("keyword_fix_prompt_tokens_estimate", {
    requestId,
    tokens_estimate: estimateTokens(prompt),
  });

  const messages = [
    { role: "system", content: "You are a precise JSON-only keyword fixer." },
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

  log.verbose("keyword_fix_llm_response", {
    requestId,
    length: raw?.length || 0,
  });
  log.info("keyword_fix_usage", {
    requestId,
    input_tokens: result.usage_normalized?.input_tokens,
    output_tokens: result.usage_normalized?.output_tokens,
  });

  llmCallsCollector?.push({
    step: "keyword_fix",
    provider: provider.name(),
    model: modelId || null,
    provider_response_id: result.provider_response_id,
    model_version: result.model_version,
    usage_raw: result.usage_raw,
    usage_normalized: result.usage_normalized,
  });

  const parsed = parseJsonStrict(raw);
  log.verbose("keyword_fix_parsed", { requestId, workflow: parsed.workflow });
  return parsed;
}
