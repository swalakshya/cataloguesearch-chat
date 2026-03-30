import express from "express";
import cors from "cors";
import crypto from "crypto";

import { SessionRegistry } from "./sessions/registry.js";
import { OpenAIProvider } from "./providers/openai.js";
import { GeminiProvider } from "./providers/gemini.js";
import { ExternalApiClient } from "./agent_api/client.js";
import { runKeywordExtraction } from "./orchestrator/keyword_extract.js";
import { runWorkflow } from "./orchestrator/workflow_router.js";
import { runAnswerSynthesis } from "./orchestrator/answer_synthesis.js";
import { buildContext, cleanChunks, extractChunkIds } from "./orchestrator/chunk_utils.js";
import { extractReferences, sanitizeCitations, sanitizeReferences, stripCitations } from "./utils/answer.js";
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

const provider = initProvider(PROVIDER_ID);
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

    const { workflowName, chunks } = await runWorkflow({
      externalApi,
      keywordResult,
      requestId,
    });

    const cleanedChunks = cleanChunks(chunks);
    log.info("context_prepared", {
      requestId,
      sessionId: session.sessionId,
      chunks: cleanedChunks.length,
    });
    const context = buildContext(cleanedChunks);
    const warnings = [];
    if (!cleanedChunks.length) {
      warnings.push("no_context_found");
    }

    const answerPayload = await runAnswerSynthesis({
      provider,
      question: content,
      workflowName,
      context,
      conversationHistory: session.conversationHistory,
      requestId,
    });

    const answerRaw = String(answerPayload?.answer || "");
    const cleaned = stripCitations(answerRaw);
    const { answer, references, citations } = extractReferences(cleaned);
    const safeReferences = sanitizeReferences(references);
    const safeCitations = sanitizeCitations(citations);
    log.info("answer_parsed", {
      requestId,
      sessionId: session.sessionId,
      answerLength: answer.length,
      referencesCount: safeReferences.length,
      citationsCount: safeCitations.length,
    });

    const chunkIds = extractChunkIds(cleanedChunks);
    const scoring = Array.isArray(answerPayload?.scoring) ? answerPayload.scoring : [];
    const scoredChunks = buildScoredChunks(scoring, chunkIds);

    session.messages.push({ role: "assistant", content: answer });
    session.tokenCount = (session.tokenCount || 0) + estimateTokens(answer);
    session.lastActivityAt = Date.now();
    const nextSetId = `set_${session.conversationHistory.length + 1}`;
    session.conversationHistory.push({
      id: nextSetId,
      question: content,
      answer,
      chunk_ids: scoredChunks.length ? scoredChunks.map((entry) => entry.chunk_id) : chunkIds,
      chunk_scores: scoredChunks,
    });
    session.busy = false;

    res.json({
      answer,
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

function initProvider(providerId) {
  if (providerId === "openai") {
    const provider = OpenAIProvider.fromEnv();
    return provider;
  }
  if (providerId === "gemini") {
    return GeminiProvider.fromEnv();
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
    content_type: sanitizeContentType(filters.content_type),
    year_from: sanitizeNumber(filters.year_from),
    year_to: sanitizeNumber(filters.year_to),
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
  const valid = ["Pravachan", "Granth", "Books"];
  if (Array.isArray(value)) {
    const filtered = value.filter((v) => valid.includes(v));
    return filtered.length ? filtered : undefined;
  }
  if (typeof value === "string" && valid.includes(value)) return [value];
  return undefined;
}

function buildScoredChunks(scoring, allowedChunkIds) {
  const allowed = new Set(allowedChunkIds);
  const scored = [];
  for (const entry of scoring) {
    if (!entry || typeof entry !== "object") continue;
    const chunkId = String(entry.chunk_id || "").trim();
    if (!chunkId || !allowed.has(chunkId)) continue;
    const score = Number(entry.score);
    if (!Number.isFinite(score)) continue;
    const normalizedScore = Math.max(1, Math.min(100, Math.trunc(score)));
    scored.push({ chunk_id: chunkId, score: normalizedScore });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored;
}
