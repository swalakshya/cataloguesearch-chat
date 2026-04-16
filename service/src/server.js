import express from "express";
import cors from "cors";
import crypto from "crypto";

import { SessionRegistry } from "./sessions/registry.js";
import { ProviderFactory } from "./providers/provider_factory.js";
import { ExternalApiClient } from "./agent_api/client.js";
import { runKeywordExtraction } from "./orchestrator/keyword_extract.js";
import { getPromptRootForModel } from "./orchestrator/prompts.js";
import { retryWorkflowOnEmptyChunks } from "./orchestrator/keyword_fix_retry.js";
import { runAnswerSynthesis } from "./orchestrator/answer_synthesis.js";
import { buildContext, cleanChunks, extractChunkIds } from "./utils/chunk.js";
import {
  buildSummaryPrompt,
  compactHistoryIfNeeded,
  getHistorySummaryThreshold,
  getHistorySummaryTopChunks,
} from "./orchestrator/history_summary.js";
import {
  appendReferencesSection,
  buildStructuredReferencesFromMetadata,
  extractReferences,
  sanitizeCitations,
  sanitizeFollowUpQuestions,
  sanitizeReferences,
  stripCitations,
  normalizeAnswerTextForParsing,
  normalizeAnswerTextForOutput,
  cleanAnswerText,
  normalizeReferencesInAnswer,
} from "./utils/answer.js";
import { buildNoContextAnswer, getNoContextTextForLocale } from "./utils/no_context.js";
import { buildGreetingAnswer } from "./utils/greeting.js";
import { buildHashedChunks, getChunkHash, mapHashedIdsToReal } from "./utils/chunk_hash.js";
import { buildScoredChunks } from "./utils/scoring.js";
import { estimateTokens, shouldRejectForTokenLimit, getSessionTokenLimit } from "./utils/token.js";
import { log } from "./utils/log.js";
import { MODEL_ROUTING_CONFIG } from "./config/model_config.js";
import { getOrderedModels } from "./routing/model_registry.js";
import { ModelAvailabilityTracker } from "./routing/model_availability.js";
import { ModelRouter } from "./routing/model_router.js";
import { sanitizeAllowedContentTypes } from "./config/content_types.js";
import {
  buildTestProviderFactory,
  getTestProviderStats,
  resetTestProviderStats,
  setTestProviderBehavior,
} from "./testing/test_provider_factory.js";
import { buildTestExternalApiClient } from "./testing/test_external_api.js";
import { getPromptRootForTest, resetPromptRootsForTest } from "./testing/test_prompt_roots.js";

const app = express();
app.use(cors());
app.use(express.json({ limit: "1mb" }));

const PORT = Number(process.env.LLM_SERVICE_PORT || 8012);
const SESSION_IDLE_MS = Number(process.env.LLM_SESSION_IDLE_TIMEOUT_SEC || 900) * 1000;

const DEFAULT_PROVIDER = "auto";
const DEFAULT_MODEL = null;
const TEST_MODE = String(process.env.TEST_MODE || "").toLowerCase() === "true";

const EXTERNAL_API_BASE_URL = process.env.EXTERNAL_API_BASE_URL || "http://localhost:8000";
const EXTERNAL_API_TIMEOUT_MS = Number(process.env.EXTERNAL_API_TIMEOUT_SEC || 60) * 1000;
const SESSION_TOKEN_LIMIT = resolveSessionTokenLimit();
const SESSION_TOKEN_LIMIT_THRESHOLD = Number(process.env.LLM_SESSION_TOKEN_LIMIT_THRESHOLD || 0.8);

const models = getOrderedModels();
const availability = new ModelAvailabilityTracker({
  windowMs: MODEL_ROUTING_CONFIG.windowMs,
  failureRateThreshold: MODEL_ROUTING_CONFIG.failureRateThreshold,
  minSamples: MODEL_ROUTING_CONFIG.minSamples,
});
const router = new ModelRouter({ models, tracker: availability, logger: log });
const providerFactory = TEST_MODE ? buildTestProviderFactory() : new ProviderFactory();
const externalApi = TEST_MODE
  ? buildTestExternalApiClient()
  : new ExternalApiClient({
      baseUrl: EXTERNAL_API_BASE_URL,
      timeoutMs: EXTERNAL_API_TIMEOUT_MS,
    });

const registry = new SessionRegistry(SESSION_IDLE_MS);

log.info("service_start", {
  port: PORT,
  provider: DEFAULT_PROVIDER,
  model: DEFAULT_MODEL,
  models: models.map((model) => ({ id: model.id, provider: model.provider, priority: model.priority })),
  externalApi: EXTERNAL_API_BASE_URL,
  externalTimeoutMs: EXTERNAL_API_TIMEOUT_MS,
});

app.get("/v1/health", (_, res) => {
  res.json({ status: "ok" });
});

if (TEST_MODE) {
  app.post("/v1/test/reset", (req, res) => {
    availability.reset();
    resetTestProviderStats();
    resetPromptRootsForTest();
    res.json({ status: "ok" });
  });

  app.post("/v1/test/provider-behavior", (req, res) => {
    setTestProviderBehavior(req.body?.behaviors || {});
    res.json({ status: "ok" });
  });

  app.get("/v1/test/provider-stats", (req, res) => {
    res.json({ calls: getTestProviderStats() });
  });

  app.get("/v1/test/prompt-root", (req, res) => {
    const requestId = String(req.query?.request_id || "");
    if (!requestId) return res.status(400).json({ detail: "request_id_required" });
    const entry = getPromptRootForTest(requestId);
    if (!entry) return res.status(404).json({ detail: "prompt_root_not_found" });
    res.json({
      request_id: entry.requestId,
      model_id: entry.modelId,
      prompt_root: entry.promptRoot,
    });
  });

  app.get("/v1/test/session/:sessionId/history", (req, res) => {
    const session = registry.get(req.params.sessionId);
    if (!session) return res.status(404).json({ detail: "session_not_found" });
    res.json({ history: session.conversationHistory || [] });
  });
}

app.post("/v1/chat/sessions", async (req, res) => {
  const { provider: providerId, language } = req.body || {};
  const requestedProvider = providerId ? String(providerId).toLowerCase() : "auto";
  if (requestedProvider !== "auto") {
    return res.status(400).json({ detail: "provider_not_supported" });
  }

  try {
    const sessionId = crypto.randomUUID();
    registry.create({
      sessionId,
      provider: "auto",
      providerSessionId: null,
      language: language || "hi",
      model: null,
      createdAt: Date.now(),
      lastActivityAt: Date.now(),
      messages: [],
      tokenCount: 0,
      chunkIdMap: {},
      chunkIdReverseMap: {},
      chunkIdCounter: 0,
      conversationHistory: [],
      busy: false,
    });

    log.info("session_create_success", {
      sessionId,
      provider: "auto",
      model: null,
      providerSessionId: null,
    });

    res.json({ session_id: sessionId, provider: "auto" });
  } catch (err) {
    log.error("session_create_failed", {
      message: err?.message || String(err),
      stack: err?.stack,
    });
    res.status(500).json({ detail: "session_create_failed" });
  }
});

app.post("/v1/chat/sessions/:sessionId/messages", async (req, res) => {
  const session = registry.get(req.params.sessionId);
  if (!session) {
    log.warn("message_session_not_found", { sessionId: req.params.sessionId });
    return res.status(404).json({ detail: "session_not_found" });
  }
  if (session.busy) {
    log.warn("message_session_busy", { sessionId: req.params.sessionId });
    return res.status(409).json({ detail: "session_busy" });
  }

  const { role, content, filters: uiFilters } = req.body || {};
  if (role !== "user" || !content) {
    log.warn("message_invalid", { sessionId: req.params.sessionId });
    return res.status(400).json({ detail: "invalid_message" });
  }

  if (
    shouldRejectForTokenLimit({
      currentTokens: session.tokenCount || 0,
      incomingText: content,
      limit: SESSION_TOKEN_LIMIT,
      threshold: SESSION_TOKEN_LIMIT_THRESHOLD,
    })
  ) {
    log.warn("session_token_limit_reached", { sessionId: session.sessionId, tokenCount: session.tokenCount });
    return res.status(429).json({
      detail: "Token Limit Exhausted for the session. Please initiate a new session.",
      customer_message: "Please start a new chat for better answer accuracy.",
    });
  }

  session.busy = true;
  session.lastActivityAt = Date.now();
  session.messages.push({ role: "user", content });
  session.tokenCount = (session.tokenCount || 0) + estimateTokens(content);

  const requestId = crypto.randomUUID();

  const availableModels = router.getAvailableModels();
  log.info("model_availability_status", {
    requestId,
    sessionId: session.sessionId,
    models: models.map((model) => {
      const stats = availability.getStats(model.id);
      return {
        modelId: model.id,
        provider: model.provider,
        available: availability.isAvailable(model.id),
        total: stats.total,
        failures: stats.failures,
        failureRate: stats.failureRate,
      };
    }),
  });
  log.info("model_routing_start", {
    requestId,
    sessionId: session.sessionId,
    candidates: availableModels.map((model) => model.id),
  });

  const attemptWithModel = async (model) => {
    log.info("model_routing_attempt", {
      requestId,
      sessionId: session.sessionId,
      modelId: model.id,
      provider: model.provider,
    });
    const provider = await providerFactory.getProvider({
      providerId: model.provider,
      modelId: model.id,
    });
    try {
      const response = await handleMessageWithProvider({
        provider,
        model,
        session,
        content,
        uiFilters,
        requestId,
      });
      log.info("model_routing_success", {
        requestId,
        sessionId: session.sessionId,
        modelId: model.id,
        provider: model.provider,
      });
      return response;
    } catch (err) {
      log.warn("model_routing_failure", {
        requestId,
        sessionId: session.sessionId,
        modelId: model.id,
        provider: model.provider,
        message: err?.message || String(err),
      });
      throw err;
    }
  };

  try {
    const responsePayload = await router.route(attemptWithModel);
    session.busy = false;
    res.json(responsePayload);
  } catch (err) {
    session.busy = false;
    const message = err?.message || String(err);
    log.error("message_failed", {
      requestId,
      sessionId: session.sessionId,
      message,
      stack: err?.stack,
    });

    if (err?.code === "service_unavailable") {
      return res.status(503).json({ detail: "service_unavailable" });
    }
    if (Number.isFinite(err?.status) && err.status >= 400 && err.status < 500) {
      return res.status(err.status).json({ detail: "client_error" });
    }
    if (message.includes("External API")) {
      return res.status(502).json({ detail: "tool_backend_error" });
    }
    if (message.includes("OpenAI")) {
      return res.status(503).json({ detail: "provider_unavailable" });
    }
    if (
      message.includes("Service Unavailable") ||
      message.includes("UNAVAILABLE") ||
      message.includes("model is currently experiencing high demand")
    ) {
      return res.status(503).json({ detail: "model_temporarily_unavailable" });
    }
    if (message.includes("tool_call_budget_exceeded")) {
      return res.status(429).json({ detail: "tool_call_budget_exceeded" });
    }
    res.status(500).json({ detail: "message_failed" });
  }
});

app.get("/v1/chat/sessions/:sessionId", (req, res) => {
  const session = registry.get(req.params.sessionId);
  if (!session) {
    return res.status(404).json({ detail: "session_not_found" });
  }
  res.json({
    session_id: session.sessionId,
    provider: session.provider,
    language: session.language,
    created_at: session.createdAt / 1000,
    last_activity_at: session.lastActivityAt / 1000,
    messages: session.messages,
  });
});

app.delete("/v1/chat/sessions/:sessionId", (req, res) => {
  registry.close(req.params.sessionId);
  res.json({ status: "closed" });
});

app.listen(PORT, () => {
  log.info("server_listen", { port: PORT, provider: DEFAULT_PROVIDER, model: DEFAULT_MODEL });
});

function resolveSessionTokenLimit() {
  const raw = process.env.LLM_SESSION_TOKEN_LIMIT;
  if (raw !== undefined && raw !== null && String(raw).trim() !== "") {
    const value = Number(raw);
    if (Number.isFinite(value) && value > 0) return value;
  }
  const configured = getSessionTokenLimit(DEFAULT_PROVIDER, DEFAULT_MODEL);
  if (Number.isFinite(configured) && configured > 0) return configured;
  log.warn("session_token_limit_unset", { provider: DEFAULT_PROVIDER, model: DEFAULT_MODEL });
  return 0;
}

async function handleMessageWithProvider({ provider, model, session, content, uiFilters, requestId }) {
  log.info("model_prompt_root", {
    requestId,
    sessionId: session.sessionId,
    modelId: model.id,
    promptRoot: getPromptRootForModel({ modelId: model.id }),
  });
  const baseHistory = Array.isArray(session.conversationHistory) ? [...session.conversationHistory] : [];
  let keywordResult = await runKeywordExtraction({
    provider,
    question: content,
    sessionContext: {
      conversationHistory: baseHistory,
    },
    requestId,
    modelId: model.id,
  });

  const normalizedUiFilters = normalizeUiFilters(uiFilters);

  log.info("keyword_extraction_complete", {
    requestId,
    sessionId: session.sessionId,
    workflow: keywordResult.workflow,
    isFollowup: keywordResult.is_followup,
    modelId: model.id,
  });

  const workingHistory = keywordResult.is_followup ? baseHistory : [];

  if (keywordResult.workflow === "greeting_message_v1") {
    const greeting = buildGreetingAnswer({
      script: keywordResult.script,
      email: process.env.GREETING_CONTACT_EMAIL,
    });

    const updatedHistory = [
      ...workingHistory,
      {
        id: `set_${workingHistory.length + 1}`,
        question: content,
        answer: greeting,
        chunk_ids: [],
        chunk_scores: [],
      },
    ];

    session.messages.push({ role: "assistant", content: greeting });
    session.tokenCount = (session.tokenCount || 0) + estimateTokens(greeting);
    session.lastActivityAt = Date.now();
    session.conversationHistory = updatedHistory;
    session.provider = model.provider;
    session.model = model.id;

    return {
      answer: greeting,
      follow_up_questions: [],
      references: [],
      citations: [],
      provider: session.provider,
      tool_trace_id: requestId,
      warnings: null,
    };
  }

  const workflowOutcome = await retryWorkflowOnEmptyChunks({
    initialKeywordResult: keywordResult,
    question: content,
    requestId,
    provider,
    externalApi,
    modelId: model.id,
    prepareKeywordResult: (result) => {
      const prepared = { ...result };
      if (normalizedUiFilters) {
        prepared.filters = mergeFilters(prepared.filters, normalizedUiFilters);
      }
      if (prepared.is_followup && Array.isArray(prepared.expand_chunk_ids)) {
        prepared.expand_chunk_ids = mapHashedIdsToReal(prepared.expand_chunk_ids, session);
      }
      return prepared;
    },
  });

  let { workflowName, chunks, keywordResult: finalKeywordResult, keywordFixApplied } = workflowOutcome;
  if (keywordFixApplied) {
    log.info("keyword_fix_applied", {
      requestId,
      sessionId: session.sessionId,
      workflow: finalKeywordResult.workflow,
    });
  }

  keywordResult = finalKeywordResult;

  const isMetadataWorkflow = workflowName === "metadata_question_v1";
  const metadataByRealId = isMetadataWorkflow ? {} : buildChunkMetadataMap(chunks);
  const cleanedChunks = isMetadataWorkflow ? (Array.isArray(chunks) ? chunks : []) : cleanChunks(chunks);
  log.info("context_prepared", {
    requestId,
    sessionId: session.sessionId,
    chunks: cleanedChunks.length,
  });
  const emptyTextCount = cleanedChunks.filter(
    (chunk) => !String(chunk?.t || "").trim()
  ).length;
  log.info("context_sample", {
    requestId,
    sessionId: session.sessionId,
    chunks_total: cleanedChunks.length,
    chunks_empty_text: emptyTextCount,
    sample: cleanedChunks.slice(0, 2).map((chunk) => ({
      id: chunk?.id,
      t: String(chunk?.t || "").slice(0, 200),
    })),
  });
  const hashedChunks = isMetadataWorkflow ? cleanedChunks : buildHashedChunks(cleanedChunks, session);
  const context = buildContext(hashedChunks);
  const warnings = [];
  if (!cleanedChunks.length) {
    warnings.push("no_context_found");
    const fallback = buildNoContextAnswer({
      language: keywordResult.language,
      script: keywordResult.script,
    });
    const answerForOutput = normalizeReferencesInAnswer(
      normalizeAnswerTextForOutput(stripCitations(fallback))
    );

    const updatedHistory = [
      ...workingHistory,
      {
        id: `set_${workingHistory.length + 1}`,
        question: content,
        answer: answerForOutput,
        chunk_ids: [],
        chunk_scores: [],
      },
    ];

    session.messages.push({ role: "assistant", content: answerForOutput });
    session.tokenCount = (session.tokenCount || 0) + estimateTokens(answerForOutput);
    session.lastActivityAt = Date.now();
    session.conversationHistory = updatedHistory;
    session.provider = model.provider;
    session.model = model.id;

    scheduleHistorySummary({ provider, session, requestId });

    log.info("answer_parsed", {
      requestId,
      sessionId: session.sessionId,
      answerLength: answerForOutput.length,
      referencesCount: 0,
      citationsCount: 0,
    });
    log.info("conversation_history_ids", {
      requestId,
      sessionId: session.sessionId,
      conversationHistoryIds: session.conversationHistory.map((entry) => entry?.id).filter(Boolean),
    });

    return {
      answer: answerForOutput,
      follow_up_questions: [],
      references: [],
      citations: [],
      provider: session.provider,
      tool_trace_id: requestId,
      warnings,
    };
  }
  if (isMetadataWorkflow) {
    log.info("metadata_context_for_llm", {
      requestId,
      sessionId: session.sessionId,
      asked_info: keywordResult.asked_info || [],
      context,
    });
  }

  const answerPayload = await runAnswerSynthesis({
    provider,
    question: content,
    workflowName,
    context,
    conversationHistory: keywordResult.is_followup ? workingHistory : [],
    followupSetIds:
      keywordResult.is_followup && Array.isArray(keywordResult.followup_keywords)
        ? keywordResult.followup_keywords.map((item) => item?.id).filter(Boolean)
        : null,
    language: keywordResult.language,
    script: keywordResult.script,
    requestId,
    modelId: model.id,
  });

  const answerRaw = String(answerPayload?.answer || "");
  const followUpQuestions = sanitizeFollowUpQuestions(answerPayload?.follow_up_questions);
  const isNoAnswer = answerRaw.trim() === "NO_ANSWER";
  const resolvedAnswer = isNoAnswer
    ? getNoContextTextForLocale({
        language: keywordResult.language,
        script: keywordResult.script,
        isMetadata: isMetadataWorkflow,
      })
    : answerRaw;
  const cleanedRaw = cleanAnswerText({
    text: resolvedAnswer,
    language: keywordResult.language,
    script: keywordResult.script,
  });
  const normalizedForParsing = normalizeAnswerTextForParsing(cleanedRaw);
  const cleaned = stripCitations(normalizedForParsing);
  const { answer, references, citations } = extractReferences(cleaned);

  const hashedChunkIds = extractChunkIds(hashedChunks);
  const scoring = Array.isArray(answerPayload?.scoring) ? answerPayload.scoring : [];
  const scoredChunks = buildScoredChunks(scoring, hashedChunkIds);
  const structured = buildStructuredReferencesFromMetadata({
    scoredChunks,
    parsedReferencesCount: references.length,
    hashToRealId: session.chunkIdMap,
    metadataByRealId,
    language: keywordResult.language,
  });
  const safeReferences = sanitizeReferences(structured.references.length ? structured.references : references);
  const safeCitations = sanitizeCitations(structured.citations.length ? structured.citations : citations);
  const answerForOutput = safeReferences.length
    ? appendReferencesSection(normalizeAnswerTextForOutput(answer), safeReferences, keywordResult.language)
    : normalizeAnswerTextForOutput(answer);
  log.info("answer_parsed", {
    requestId,
    sessionId: session.sessionId,
    answerLength: answerForOutput.length,
    referencesCount: safeReferences.length,
    citationsCount: safeCitations.length,
  });

  const updatedHistory = [
    ...workingHistory,
    {
      id: `set_${workingHistory.length + 1}`,
      question: content,
      answer: answerForOutput,
      chunk_ids: scoredChunks.length ? scoredChunks.map((entry) => entry.chunk_id) : hashedChunkIds,
      chunk_scores: scoredChunks,
    },
  ];

  session.messages.push({ role: "assistant", content: answerForOutput });
  session.tokenCount = (session.tokenCount || 0) + estimateTokens(answerForOutput);
  session.lastActivityAt = Date.now();
  session.conversationHistory = updatedHistory;
  session.provider = model.provider;
  session.model = model.id;

  scheduleHistorySummary({ provider, session, requestId });

  log.info("conversation_history_ids", {
    requestId,
    sessionId: session.sessionId,
    conversationHistoryIds: session.conversationHistory.map((entry) => entry?.id).filter(Boolean),
  });

  return {
    answer: answerForOutput,
    follow_up_questions: followUpQuestions,
    references: safeReferences,
    citations: safeCitations,
    provider: session.provider,
    tool_trace_id: requestId,
    warnings: warnings.length ? warnings : null,
  };
}

function scheduleHistorySummary({ provider, session, requestId }) {
  const threshold = getHistorySummaryThreshold();
  const topChunks = getHistorySummaryTopChunks();
  if (!Number.isFinite(threshold) || threshold <= 0) return;

  setImmediate(async () => {
    try {
      const snapshot = Array.isArray(session.conversationHistory)
        ? session.conversationHistory.slice()
        : [];

      const { didCompact, history } = await compactHistoryIfNeeded({
        history: snapshot,
        threshold,
        topChunksPerSet: topChunks,
        summarize: async (entries) => {
          const prompt = buildSummaryPrompt(entries);
          const messages = [
            {
              role: "system",
              content:
                "You are a concise Hindi summarizer for Jainism Q&A. Summarize the conversation below in Hindi. Output only the summary text. Target length is 1000 tokens (soft).",
            },
            { role: "user", content: prompt },
          ];
          const text = await provider.completeText({
            messages,
            temperature: 0.2,
            maxTokens: 2000,
            requestId,
          });
          return String(text || "").trim();
        },
      });

      if (!didCompact) return;

      const current = Array.isArray(session.conversationHistory)
        ? session.conversationHistory
        : [];
      if (current.length !== snapshot.length) return;

      session.conversationHistory = history;
    } catch (err) {
      log.warn("history_summary_failed", {
        requestId,
        message: err?.message || String(err),
      });
    }
  });
}

function normalizeUiFilters(filters) {
  if (!filters || typeof filters !== "object") return null;
  const cleaned = {
    granth: sanitizeString(filters.granth),
    anuyog: sanitizeString(filters.anuyog),
    contributor: sanitizeString(filters.contributor),
    content_type: sanitizeContentType(filters.content_type)
  };
  const hasAny = Object.values(cleaned).some((value) => value !== undefined && value !== null && value !== "");
  return hasAny ? cleaned : null;
}

function mergeFilters(modelFilters, uiFilters) {
  if (!uiFilters) return modelFilters || {};
  return {
    ...(modelFilters || {}),
    ...Object.fromEntries(Object.entries(uiFilters).filter(([, value]) => value !== undefined && value !== null && value !== "")),
  };
}

function sanitizeString(value) {
  if (value === undefined || value === null) return undefined;
  const str = String(value).trim();
  return str ? str : undefined;
}

function sanitizeContentType(value) {
  const normalized = sanitizeAllowedContentTypes(value, { fallbackToDefault: false });
  return normalized.length ? normalized : undefined;
}

function buildChunkMetadataMap(chunks) {
  if (!Array.isArray(chunks)) return {};
  const map = {};
  for (const chunk of chunks) {
    const metadata = toChunkMetadataRecord(chunk);
    if (!metadata.chunk_id) continue;
    map[metadata.chunk_id] = metadata;
  }
  return map;
}

function toChunkMetadataRecord(chunk) {
  if (!chunk || typeof chunk !== "object") return {};
  const metadata = chunk.metadata && typeof chunk.metadata === "object" ? chunk.metadata : {};
  return {
    chunk_id: chunk.chunk_id || metadata.chunk_id || "",
    category: chunk.category || metadata.category || "",
    granth: chunk.granth || metadata.granth || "",
    author: chunk.author || metadata.author || "",
    anuyog: chunk.anuyog || metadata.anuyog || "",
    language: chunk.language || metadata.language || "",
    date: chunk.date || metadata.date || "",
    pravachan_number: chunk.pravachan_number || metadata.pravachan_number || "",
    series_number: chunk.series_number || metadata.series_number || "",
    gatha: chunk.gatha || metadata.gatha || "",
    kalash: chunk.kalash || metadata.kalash || "",
    shlok: chunk.shlok || metadata.shlok || "",
    dohra: chunk.dohra || metadata.dohra || "",
    volume: chunk.volume ?? metadata.volume ?? null,
    series_start_date: chunk.series_start_date || metadata.series_start_date || "",
    series_end_date: chunk.series_end_date || metadata.series_end_date || "",
    page_number: chunk.page_number ?? metadata.page_number ?? null,
    file_url: chunk.file_url || metadata.file_url || "",
    pravachankar: normalizePravachankar(chunk, metadata),
  };
}

function normalizePravachankar(chunk, metadata) {
  return (
    chunk?.pravachankar ||
    metadata?.pravachankar ||
    chunk?.Pravachankar ||
    metadata?.Pravachankar ||
    ""
  );
}

export function buildHashedChunksForTest(chunks, session) {
  return buildHashedChunks(chunks, session);
}

export function getChunkHashForTest(session, realId) {
  return getChunkHash(session, realId);
}

export function mapHashedIdsToRealForTest(ids, session) {
  return mapHashedIdsToReal(ids, session);
}
