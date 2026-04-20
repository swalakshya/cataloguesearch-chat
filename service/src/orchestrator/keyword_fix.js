import { getKeywordFixPrompt } from "./prompts.js";
import { KEYWORD_EXTRACTION_SCHEMA } from "../config/keyword_schema.js";
import { parseJsonStrict } from "../utils/json.js";
import { estimateTokens } from "../utils/token.js";
import { log } from "../utils/log.js";

export async function runKeywordFix({ provider, question, step1Json, questionId, modelId }) {
  const prompt = getKeywordFixPrompt(question, step1Json, { modelId, questionId });
  log.info("keyword_fix_prompt_tokens", {
    questionId,
    tokens: estimateTokens(prompt),
  });

  const messages = [
    { role: "system", content: "You are a precise JSON-only keyword fixer." },
    { role: "user", content: prompt },
  ];

  const raw = await provider.completeJson({
    messages,
    temperature: 0,
    questionId,
    responseJsonSchema: KEYWORD_EXTRACTION_SCHEMA,
  });

  log.info("keyword_fix_llm_response", {
    questionId,
    length: raw?.length || 0,
  });

  const parsed = parseJsonStrict(raw);
  log.debug("keyword_fix_parsed", { questionId, workflow: parsed.workflow });
  return parsed;
}
