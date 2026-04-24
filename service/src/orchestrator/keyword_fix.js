import { getKeywordFixPrompt } from "./prompts.js";
import { KEYWORD_EXTRACTION_SCHEMA } from "../config/keyword_schema.js";
import { parseJsonStrict } from "../utils/json.js";
import { estimateTokens } from "../utils/token.js";
import { log } from "../utils/log.js";

export async function runKeywordFix({ provider, question, step1Json, requestId, modelId, llmCallsCollector }) {
  const prompt = getKeywordFixPrompt(question, step1Json, { modelId, requestId });
  log.info("keyword_fix_prompt_tokens_estimate", {
    requestId,
    tokens_estimate: estimateTokens(prompt),
  });

  const messages = [
    { role: "system", content: "You are a precise JSON-only keyword fixer." },
    { role: "user", content: prompt },
  ];

  const result = await provider.completeJson({
    messages,
    temperature: 0,
    requestId,
    responseJsonSchema: KEYWORD_EXTRACTION_SCHEMA,
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
