import { getKeywordPrompt, isPromptV2 } from "./prompts.js";
import { KEYWORD_EXTRACTION_SCHEMA } from "../config/keyword_schema.js";
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
}) {
  const useV2 = isPromptV2();
  const history = formatConversationHistory(sessionContext?.conversationHistory, {
    includeChunkScores: true,
    includeAnswers: true,
    compact: useV2,
  });
  const prompt = getKeywordPrompt(question, history, { modelId, requestId });
  log.info("keyword_extract_prompt_tokens", {
    requestId,
    tokens: estimateTokens(prompt),
  });

  const messages = [
    { role: "system", content: "You are a precise JSON-only keyword extractor and question classifier. This json will be used for a RAG-retrieval from Jainism related Texts." },
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
    response: String(raw || ""),
  });
  log.info("keyword_extract_output_tokens", {
    requestId,
    tokens: estimateTokens(raw),
  });

  const parsed = parseJsonStrict(raw);
  log.debug("keyword_extract_parsed", { requestId, workflow: parsed.workflow });
  return parsed;
}
