import { getAnswerPrompt, getWorkflowGuidelines } from "./prompts.js";
import { formatConversationHistory } from "./conversation_history.js";
import { ANSWER_SCHEMA } from "./answer_schema.js";
import { parseJsonStrict } from "../utils/json.js";
import { estimateTokens } from "../utils/token.js";
import { log } from "../utils/log.js";

export async function runAnswerSynthesis({
  provider,
  question,
  workflowName,
  context,
  conversationHistory,
  requestId,
}) {
  const guidelines = getWorkflowGuidelines(workflowName);
  const history = formatConversationHistory(conversationHistory);
  const prompt = getAnswerPrompt(question, context, guidelines, history);
  log.info("answer_synthesis_prompt_tokens", {
    requestId,
    tokens: estimateTokens(prompt),
  });

  const messages = [
    { role: "system", content: "You are a Jain texts scholar." },
    { role: "user", content: prompt },
  ];

  const raw = await provider.completeJson({
    messages,
    temperature: Number(process.env.LLM_TEMPERATURE || 0.75),
    requestId,
    responseJsonSchema: ANSWER_SCHEMA,
  });

  // Logged at info to correlate with downstream response parsing.
  // Avoid logging full answer to keep logs manageable.
  log.info("answer_synthesis_llm_response", {
    requestId,
    length: raw?.length || 0,
    preview: String(raw || "").slice(0, 500),
  });

  const parsed = await parseOrRepairJson({
    raw,
    provider,
    requestId,
  });
  log.info("answer_synthesis_scoring", {
    requestId,
    scoring: Array.isArray(parsed?.scoring) ? parsed.scoring : [],
  });
  return parsed;
}

async function parseOrRepairJson({ raw, provider, requestId }) {
  try {
    return parseJsonStrict(raw);
  } catch (err) {
    log.warn("answer_synthesis_json_parse_failed", {
      requestId,
      message: err?.message || String(err),
      preview: String(raw || "").slice(0, 500),
    });
  }

  const repairMessages = [
    { role: "system", content: "You are a JSON repair tool. Output only valid JSON." },
    {
      role: "user",
      content: `Fix the following into a valid JSON object that matches the required schema. Output JSON only.\n\n${raw}`,
    },
  ];

  const repairedRaw = await provider.completeJson({
    messages: repairMessages,
    temperature: 0,
    requestId,
    responseJsonSchema: ANSWER_SCHEMA,
  });

  log.info("answer_synthesis_llm_repair_response", {
    requestId,
    length: repairedRaw?.length || 0,
    preview: String(repairedRaw || "").slice(0, 500),
  });

  return parseJsonStrict(repairedRaw);
}
