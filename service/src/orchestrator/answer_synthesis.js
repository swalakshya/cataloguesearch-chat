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
  llmCallsCollector,
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
  log.info("answer_synthesis_prompt_tokens_estimate", {
    requestId,
    tokens_estimate: estimateTokens(prompt),
  });

  const messages = [
    { role: "system", content: "You are a Jain texts scholar. You task is to answer a user question/request." },
    { role: "user", content: prompt },
  ];

  const result = await provider.completeJson({
    messages,
    temperature: Number(process.env.LLM_TEMPERATURE || 0.75),
    requestId,
    responseJsonSchema,
  });

  const raw = result.text;

  // Logged at info to correlate with downstream response parsing.
  // Avoid logging full answer to keep logs manageable.
  log.verbose("answer_synthesis_llm_response", {
    requestId,
    length: raw?.length || 0,
    preview: String(raw || "").slice(0, 500),
  });
  log.info("answer_synthesis_usage", {
    requestId,
    input_tokens: result.usage_normalized?.input_tokens,
    output_tokens: result.usage_normalized?.output_tokens,
    cached_input_tokens: result.usage_normalized?.cached_input_tokens,
    thought_tokens: result.usage_normalized?.thought_tokens,
  });

  llmCallsCollector?.push({
    step: "answer_synthesis",
    provider: provider.name(),
    model: modelId || null,
    provider_response_id: result.provider_response_id,
    model_version: result.model_version,
    usage_raw: result.usage_raw,
    usage_normalized: result.usage_normalized,
  });

  const parsed = await parseOrRepairJson({
    raw,
    provider,
    requestId,
    responseJsonSchema,
    responseFormat,
    modelId,
    llmCallsCollector,
  });
  log.info("answer_synthesis_scoring", {
    requestId,
    scoring: Array.isArray(parsed?.scoring) ? parsed.scoring : [],
  });
  return parsed;
}

async function parseOrRepairJson({ raw, provider, requestId, responseJsonSchema, responseFormat, modelId, llmCallsCollector }) {
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
    const repairResult = await provider.completeJson({
      messages: repairMessages,
      temperature: 0,
      requestId,
      responseJsonSchema,
    });

    const repairedRaw = repairResult.text;

    log.verbose("answer_synthesis_llm_repair_response", {
      requestId,
      length: repairedRaw?.length || 0,
      preview: String(repairedRaw || "").slice(0, 500),
    });
    log.info("answer_json_repair_usage", {
      requestId,
      input_tokens: repairResult.usage_normalized?.input_tokens,
      output_tokens: repairResult.usage_normalized?.output_tokens,
    });

    llmCallsCollector?.push({
      step: "answer_json_repair",
      provider: provider.name(),
      model: modelId || null,
      provider_response_id: repairResult.provider_response_id,
      model_version: repairResult.model_version,
      usage_raw: repairResult.usage_raw,
      usage_normalized: repairResult.usage_normalized,
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
