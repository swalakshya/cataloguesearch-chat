import { getKeywordFixPrompt } from "./prompts.js";
import { KEYWORD_EXTRACTION_SCHEMA } from "../config/keyword_schema.js";
import { parseJsonStrict } from "../utils/json.js";
import { estimateTokens } from "../utils/token.js";
import { log } from "../utils/log.js";

export async function runKeywordFix({ provider, question, step1Json, requestId, modelId }) {
  const prompt = getKeywordFixPrompt(question, step1Json, { modelId, requestId });
  log.info("keyword_fix_prompt_tokens", {
    requestId,
    tokens: estimateTokens(prompt),
  });

  const messages = [
    { role: "system", content: "You are a precise JSON-only keyword fixer." },
    { role: "user", content: prompt },
  ];

  const raw = await provider.completeJson({
    messages,
    temperature: 0,
    requestId,
    responseJsonSchema: KEYWORD_EXTRACTION_SCHEMA,
  });

  log.info("keyword_fix_llm_response", {
    requestId,
    length: raw?.length || 0,
  });

  const parsed = parseJsonStrict(raw);
  log.debug("keyword_fix_parsed", { requestId, workflow: parsed.workflow });
  return parsed;
}
