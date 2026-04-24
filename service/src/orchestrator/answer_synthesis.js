import { getAnswerPrompt, getWorkflowGuidelines, isPromptV2 } from "./prompts.js";
import { formatConversationHistory } from "./conversation_history.js";
import { getAnswerSchema } from "../config/answer_schema.js";
import { parseJsonStrict, normalizeJsonLike, extractAnswerFallback } from "../utils/json.js";
import { estimateTokens } from "../utils/token.js";
import { log } from "../utils/log.js";

export async function runAnswerSynthesis({
  provider,
  question,
  workflowName,
  context,
  conversationHistory,
  followupSetIds,
  language,
  script,
  requestId,
  modelId,
  responseFormat = "combined",
  fullCitations,
}) {
  const guidelines = getWorkflowGuidelines(workflowName, { modelId, requestId });
  const useV2 = isPromptV2();
  const filteredHistory =
    Array.isArray(followupSetIds) && followupSetIds.length
      ? (conversationHistory || []).filter((entry) => followupSetIds.includes(entry?.id))
      : conversationHistory;
  const historyText =
    Array.isArray(filteredHistory) && filteredHistory.length
      ? formatConversationHistory(filteredHistory, {
          includeChunkScores: false,
          includeAnswers: true,
          compact: useV2,
        })
      : null;
  const history = historyText || "";
  const promptScript =
    String(language || "").toLowerCase() === "hi" &&
    String(script || "").toLowerCase() === "latin"
      ? "devanagari"
      : script;
  const prompt = getAnswerPrompt(
    question,
    context,
    guidelines,
    history,
    workflowName,
    language,
    promptScript,
    { modelId, requestId, responseFormat, fullCitations }
  );
  const responseJsonSchema = getAnswerSchema({ workflowName, responseFormat });
  log.info("answer_synthesis_prompt_tokens", {
    requestId,
    tokens: estimateTokens(prompt),
  });

  const messages = [
    { role: "system", content: "You are a Jain texts scholar. You task is to answer a user question/request." },
    { role: "user", content: prompt },
  ];

  const raw = await provider.completeJson({
    messages,
    temperature: Number(process.env.LLM_TEMPERATURE || 0.75),
    requestId,
    responseJsonSchema,
  });

  // Logged at info to correlate with downstream response parsing.
  // Avoid logging full answer to keep logs manageable.
  log.verbose("answer_synthesis_llm_response", {
    requestId,
    length: raw?.length || 0,
    preview: String(raw || "").slice(0, 500),
  });
  log.info("answer_synthesis_output_tokens", {
    requestId,
    tokens: estimateTokens(raw),
  });

  const parsed = await parseOrRepairJson({
    raw,
    provider,
    requestId,
    responseJsonSchema,
    responseFormat,
  });
  log.info("answer_synthesis_scoring", {
    requestId,
    scoring: Array.isArray(parsed?.scoring) ? parsed.scoring : [],
  });
  return parsed;
}

async function parseOrRepairJson({ raw, provider, requestId, responseJsonSchema, responseFormat }) {
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

  try {
    const repairedRaw = await provider.completeJson({
      messages: repairMessages,
      temperature: 0,
      requestId,
      responseJsonSchema,
    });

    log.verbose("answer_synthesis_llm_repair_response", {
      requestId,
      length: repairedRaw?.length || 0,
      preview: String(repairedRaw || "").slice(0, 500),
    });

    try {
      return parseJsonStrict(repairedRaw);
    } catch (err) {
      log.warn("answer_synthesis_json_repair_parse_failed", {
        requestId,
        message: err?.message || String(err),
        preview: String(repairedRaw || "").slice(0, 500),
      });
      const sanitized = normalizeJsonLike(repairedRaw);
      return parseJsonStrict(sanitized);
    }
  } catch (err) {
    log.warn("answer_synthesis_json_repair_failed", {
      requestId,
      message: err?.message || String(err),
    });
  }

  const fallbackAnswer = extractAnswerFallback(raw);
  const normalizedAnswer = String(fallbackAnswer || "");
  const answerStatus = normalizedAnswer.trim() === "NO_ANSWER" ? "no_answer" : "answered";
  return { answer_status: answerStatus, answer: normalizedAnswer, scoring: [] };
}
