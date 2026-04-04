import express from "express";
import cors from "cors";
import crypto from "crypto";

import { SessionRegistry } from "./sessions/registry.js";
import { OpenAIProvider } from "./providers/openai.js";
import { GeminiProvider } from "./providers/gemini.js";
import { buildSecretAccessor, logSecretManagerInit } from "./secrets/gcp_secret_manager.js";
import { GeminiKeyManager } from "./secrets/gemini_key_manager.js";
import { ExternalApiClient } from "./agent_api/client.js";
import { runKeywordExtraction } from "./orchestrator/keyword_extract.js";
import { runWorkflow } from "./orchestrator/workflow_router.js";
import { runAnswerSynthesis } from "./orchestrator/answer_synthesis.js";
import { buildContext, cleanChunks, extractChunkIds } from "./orchestrator/chunk_utils.js";
import { trimConversationHistoryForFollowup } from "./sessions/conversation_history.js";
import {
  extractReferences,
  sanitizeCitations,
  sanitizeReferences,
  stripCitations,
  normalizeAnswerTextForParsing,
  normalizeAnswerTextForOutput,
  cleanAnswerText,
} from "./utils/answer.js";
import { buildNoContextAnswer } from "./utils/no_context.js";
import { buildGreetingAnswer } from "./utils/greeting.js";
import { buildHashedChunks, mapHashedIdsToReal } from "./utils/chunk_hash.js";
import { buildScoredChunks } from "./utils/scoring.js";
import { estimateTokens, shouldRejectForTokenLimit, getSessionTokenLimit } from "./utils/token.js";
import { log } from "./utils/log.js";

const app = express();
app.use(cors());
app.use(express.json({ limit: "1mb" }));

const PORT = Number(process.env.LLM_SERVICE_PORT || 8012);
const SESSION_IDLE_MS = Number(process.env.LLM_SESSION_IDLE_TIMEOUT_SEC || 900) * 1000;

const PROVIDER_ID = (process.env.LLM_PROVIDER || "openai").toLowerCase();
const MODEL = process.env.LLM_MODEL || "gpt-4o";

const EXTERNAL_API_BASE_URL = process.env.EXTERNAL_API_BASE_URL || "http://localhost:8000";
const EXTERNAL_API_TIMEOUT_MS = Number(process.env.EXTERNAL_API_TIMEOUT_SEC || 60) * 1000;
const SESSION_TOKEN_LIMIT = resolveSessionTokenLimit();
const SESSION_TOKEN_LIMIT_THRESHOLD = Number(process.env.LLM_SESSION_TOKEN_LIMIT_THRESHOLD || 0.8);

const provider = await initProvider(PROVIDER_ID);
const externalApi = new ExternalApiClient({
  baseUrl: EXTERNAL_API_BASE_URL,
  timeoutMs: EXTERNAL_API_TIMEOUT_MS,
});

const registry = new SessionRegistry(SESSION_IDLE_MS);

log.info("service_start", {
  port: PORT,
  provider: PROVIDER_ID,
  model: MODEL,
  externalApi: EXTERNAL_API_BASE_URL,
  externalTimeoutMs: EXTERNAL_API_TIMEOUT_MS,
});

app.get("/v1/health", (_, res) => {
  res.json({ status: "ok" });
});

app.post("/v1/chat/sessions", async (req, res) => {
  const { provider: providerId, language } = req.body || {};
  const requestedProvider = (providerId || PROVIDER_ID).toLowerCase();
  if (requestedProvider !== PROVIDER_ID) {
    return res.status(400).json({ detail: "provider_not_supported" });
  }

  try {
    const sessionId = crypto.randomUUID();
    const providerSessionId = provider.startSession?.() || null;
    registry.create({
      sessionId,
      provider: requestedProvider,
      providerSessionId,
      language: language || "hi",
      model: MODEL,
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
      provider: requestedProvider,
      model: MODEL,
      providerSessionId,
    });

    res.json({ session_id: sessionId, provider: requestedProvider });
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

  try {
    const keywordResult = await runKeywordExtraction({
      provider,
      question: content,
      sessionContext: {
        conversationHistory: session.conversationHistory,
      },
      requestId,
    });

    const normalizedUiFilters = normalizeUiFilters(uiFilters);
    if (normalizedUiFilters) {
      keywordResult.filters = mergeFilters(keywordResult.filters, normalizedUiFilters);
    }

    log.info("keyword_extraction_complete", {
      requestId,
      sessionId: session.sessionId,
      workflow: keywordResult.workflow,
      isFollowup: keywordResult.is_followup,
    });

    session.conversationHistory = trimConversationHistoryForFollowup(
      session.conversationHistory,
      keywordResult.is_followup
    );

    if (keywordResult.is_followup && Array.isArray(keywordResult.expand_chunk_ids)) {
      keywordResult.expand_chunk_ids = mapHashedIdsToReal(keywordResult.expand_chunk_ids, session);
    }

    if (keywordResult.workflow === "greeting_message_v1") {
      const greeting = buildGreetingAnswer({
        script: keywordResult.script,
        email: process.env.GREETING_CONTACT_EMAIL,
      });

      session.messages.push({ role: "assistant", content: greeting });
      session.tokenCount = (session.tokenCount || 0) + estimateTokens(greeting);
      session.lastActivityAt = Date.now();
      const nextSetId = `set_${session.conversationHistory.length + 1}`;
      session.conversationHistory.push({
        id: nextSetId,
        question: content,
        answer: greeting,
        chunk_ids: [],
        chunk_scores: [],
      });
      session.busy = false;

      return res.json({
        answer: greeting,
        references: [],
        citations: [],
        provider: session.provider,
        tool_trace_id: requestId,
        warnings: null,
      });
    }

    const { workflowName, chunks } = await runWorkflow({
      externalApi,
      keywordResult,
      requestId,
      provider,
    });

    const isMetadataWorkflow = workflowName === "metadata_question_v1";
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
      const answerForOutput = normalizeAnswerTextForOutput(stripCitations(fallback));

      session.messages.push({ role: "assistant", content: answerForOutput });
      session.tokenCount = (session.tokenCount || 0) + estimateTokens(answerForOutput);
      session.lastActivityAt = Date.now();
      const nextSetId = `set_${session.conversationHistory.length + 1}`;
      session.conversationHistory.push({
        id: nextSetId,
        question: content,
        answer: answerForOutput,
        chunk_ids: [],
        chunk_scores: [],
      });
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
      session.busy = false;

      return res.json({
        answer: answerForOutput,
        references: [],
        citations: [],
        provider: session.provider,
        tool_trace_id: requestId,
        warnings,
      });
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
      conversationHistory: keywordResult.is_followup ? session.conversationHistory : [],
      followupSetIds:
        keywordResult.is_followup && Array.isArray(keywordResult.followup_keywords)
          ? keywordResult.followup_keywords.map((item) => item?.id).filter(Boolean)
          : null,
      language: keywordResult.language,
      script: keywordResult.script,
      requestId,
    });

    const answerRaw = String(answerPayload?.answer || "");
    const cleanedRaw = cleanAnswerText({
      text: answerRaw,
      language: keywordResult.language,
      script: keywordResult.script,
    });
    const normalizedForParsing = normalizeAnswerTextForParsing(cleanedRaw);
    const cleaned = stripCitations(normalizedForParsing);
    const { answer, references, citations } = extractReferences(cleaned);
    const answerForOutput = normalizeAnswerTextForOutput(stripCitations(cleanedRaw));
    const safeCitations = sanitizeCitations(citations);
    log.info("answer_parsed", {
      requestId,
      sessionId: session.sessionId,
      answerLength: answer.length,
      referencesCount: references.length,
      citationsCount: safeCitations.length,
    });

    const hashedChunkIds = extractChunkIds(hashedChunks);
    const scoring = Array.isArray(answerPayload?.scoring) ? answerPayload.scoring : [];
    const scoredChunks = buildScoredChunks(scoring, hashedChunkIds);

    session.messages.push({ role: "assistant", content: answerForOutput });
    session.tokenCount = (session.tokenCount || 0) + estimateTokens(answerForOutput);
    session.lastActivityAt = Date.now();
    const nextSetId = `set_${session.conversationHistory.length + 1}`;
    session.conversationHistory.push({
      id: nextSetId,
      question: content,
      answer: answerForOutput,
      chunk_ids: scoredChunks.length ? scoredChunks.map((entry) => entry.chunk_id) : hashedChunkIds,
      chunk_scores: scoredChunks,
    });
    log.info("conversation_history_ids", {
      requestId,
      sessionId: session.sessionId,
      conversationHistoryIds: session.conversationHistory.map((entry) => entry?.id).filter(Boolean),
    });
    session.busy = false;

    const safeReferences = sanitizeReferences(references);
    res.json({
      answer: answerForOutput,
      references: safeReferences,
      citations: safeCitations,
      provider: session.provider,
      tool_trace_id: requestId,
      warnings: warnings.length ? warnings : null,
    });
  } catch (err) {
    session.busy = false;
    const message = err?.message || String(err);
    log.error("message_failed", {
      requestId,
      sessionId: session.sessionId,
      message,
      stack: err?.stack,
    });

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
  log.info("server_listen", { port: PORT, provider: PROVIDER_ID, model: MODEL });
});

function resolveSessionTokenLimit() {
  const raw = process.env.LLM_SESSION_TOKEN_LIMIT;
  if (raw !== undefined && raw !== null && String(raw).trim() !== "") {
    const value = Number(raw);
    if (Number.isFinite(value) && value > 0) return value;
  }
  const configured = getSessionTokenLimit(PROVIDER_ID, MODEL);
  if (Number.isFinite(configured) && configured > 0) return configured;
  log.warn("session_token_limit_unset", { provider: PROVIDER_ID, model: MODEL });
  return 0;
}

async function initProvider(providerId) {
  if (providerId === "openai") {
    const provider = OpenAIProvider.fromEnv();
    return provider;
  }
  if (providerId === "gemini") {
    const envKey =
      process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || process.env.LLM_API_KEY || "";
    if (envKey) {
      return GeminiProvider.fromEnv();
    }

    const projectId = process.env.GCP_PROJECT_ID || "";
    const secretName = process.env.GCP_SECRET_NAME || "";
    const secretVersion = process.env.GCP_SECRET_VERSION || "latest";
    const keyFilename = process.env.GCP_SA_KEY_PATH || "";

    if (!projectId || !secretName || !keyFilename) {
      throw new Error("GCSM config missing for Gemini provider");
    }

    logSecretManagerInit({ projectId, secretName, secretVersion });
    const fetcher = buildSecretAccessor({
      projectId,
      secretName,
      secretVersion,
      keyFilename,
    });
    const keyManager = await GeminiKeyManager.create({ fetcher });

    return GeminiProvider.fromEnv({ keyManager });
  }
  log.warn("provider_not_supported", { providerId });
  throw new Error(`Provider not supported: ${providerId}`);
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

function sanitizeNumber(value) {
  if (value === undefined || value === null || value === "") return undefined;
  const num = Number(value);
  return Number.isFinite(num) ? num : undefined;
}

function sanitizeContentType(value) {
  const valid = ["Granth", "Books"];
  if (Array.isArray(value)) {
    const filtered = value.filter((v) => valid.includes(v));
    return filtered.length ? filtered : undefined;
  }
  if (typeof value === "string" && valid.includes(value)) return [value];
  return undefined;
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
