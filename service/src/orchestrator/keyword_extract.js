import { getKeywordPrompt } from "./prompts.js";
import { KEYWORD_EXTRACTION_SCHEMA } from "./keyword_schema.js";
import { formatConversationHistory } from "./conversation_history.js";
import { parseJsonStrict } from "../utils/json.js";
import { estimateTokens } from "../utils/token.js";
import { log } from "../utils/log.js";

export async function runKeywordExtraction({
  provider,
  question,
  sessionContext,
  requestId,
}) {
  const history = formatConversationHistory(sessionContext?.conversationHistory);
  const prompt = getKeywordPrompt(question, history);
  log.info("keyword_extract_prompt_tokens", {
    requestId,
    tokens: estimateTokens(prompt),
  });

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
