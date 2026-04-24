import { fileURLToPath } from "node:url";
import fs from "node:fs";
import express from "express";
import cors from "cors";
import crypto from "crypto";

import { SessionRegistry } from "./sessions/registry.js";
import { SessionStore } from "./sessions/session_store.js";
import { FeedbackStore } from "./feedback/feedback_store.js";
import { registerFeedbackRoutes } from "./feedback/feedback_routes.js";
import { RequestLogStore } from "./request_logs/request_log_store.js";
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
  buildStructuredReferencesFromMetadata,
  buildChunkCitationMap,
  expandChunkCitations,
  appendReferencesSection,
  extractFollowUpQuestionsFromAnswer,
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
import { getWorkflowReferenceCount } from "./config/workflow_config.js";
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

export function createServer(options = {}) {
  const configuredPort = Number(options.port ?? process.env.LLM_SERVICE_PORT ?? 8012);
  const configuredHost = options.host ?? "0.0.0.0";
  const sessionIdleMs = Number(options.sessionIdleMs ?? process.env.LLM_SESSION_IDLE_TIMEOUT_SEC ?? 900) * 1000;
  const defaultProvider = "auto";
  const defaultModel = null;
  const testMode = options.testMode ?? readBooleanEnv("TEST_MODE");
  const cleanSessionDb = options.cleanSessionDb ?? readBooleanEnv("CLEAN_SESSION_DB");
  const externalApiBaseUrl = options.externalApiBaseUrl ?? process.env.EXTERNAL_API_BASE_URL ?? "http://localhost:8000";
  const externalApiTimeoutMs =
    Number(options.externalApiTimeoutMs ?? process.env.EXTERNAL_API_TIMEOUT_SEC ?? 60) * 1000;
  const sessionTokenLimitThreshold = Number(
    options.sessionTokenLimitThreshold ?? process.env.LLM_SESSION_TOKEN_LIMIT_THRESHOLD ?? 0.8
  );
  const chatDbPath = String(options.chatDbPath ?? process.env.CHAT_DB_PATH ?? "").trim();
  const adminApiKey = String(options.adminApiKey ?? process.env.ADMIN_KEY ?? "").trim();
  const defaultResponseFormat =
    normalizeResponseFormat(options.defaultResponseFormat ?? process.env.DEFAULT_ANSWER_FORMAT, { fallback: "combined" });

  const app = express();
  app.use(cors());
  app.use(express.json({ limit: "1mb" }));

  const models = getOrderedModels();
  const availability = new ModelAvailabilityTracker({
    windowMs: MODEL_ROUTING_CONFIG.windowMs,
    failureRateThreshold: MODEL_ROUTING_CONFIG.failureRateThreshold,
    minSamples: MODEL_ROUTING_CONFIG.minSamples,
  });
  const router = new ModelRouter({ models, tracker: availability, logger: log });
  const providerFactory = testMode ? buildTestProviderFactory() : new ProviderFactory();
  const externalApi = testMode
    ? buildTestExternalApiClient()
    : new ExternalApiClient({
        baseUrl: externalApiBaseUrl,
        timeoutMs: externalApiTimeoutMs,
      });

  cleanSessionDbForTest({
    enabled: testMode && cleanSessionDb,
    dbPath: chatDbPath,
  });

  const sessionStore = chatDbPath ? new SessionStore(chatDbPath) : null;
  const feedbackStore = chatDbPath ? new FeedbackStore(chatDbPath) : null;
  const requestLogStore = chatDbPath ? new RequestLogStore(chatDbPath) : null;
  const registry = new SessionRegistry(sessionIdleMs, sessionStore);
  const sessionTokenLimit = resolveSessionTokenLimit({
    explicitLimit: options.sessionTokenLimit,
    defaultProvider,
    defaultModel,
  });

  const CHAT_PROGRESS_STAGES = {
    understanding: "Understanding your question",
    searching: "Searching through our scriptures",
    preparing: "Preparing answer",
  };

  let httpServer = null;
  let stopped = false;

  log.info("service_start", {
    port: configuredPort,
    provider: defaultProvider,
    model: defaultModel,
    models: models.map((model) => ({ id: model.id, provider: model.provider, priority: model.priority })),
    externalApi: externalApiBaseUrl,
    externalTimeoutMs: externalApiTimeoutMs,
    chatDbPath: chatDbPath || null,
    cleanSessionDb: testMode && cleanSessionDb,
  });

  app.get("/v1/health", (_, res) => {
    res.json({ status: "ok" });
  });

  registerFeedbackRoutes(app, feedbackStore, {
    adminApiKey: adminApiKey || null,
    requestLogStore,
  });

  if (testMode) {
    app.post("/v1/test/reset", (req, res) => {
      availability.reset();
      resetTestProviderStats();
      resetPromptRootsForTest();
      setTestProviderBehavior({});
      registry.clear();
      sessionStore?.clear();
      requestLogStore?.clear();
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

    app.get("/v1/test/sessions/in-memory", (req, res) => {
      res.json({ session_ids: registry.listSessionIds() });
    });

    app.post("/v1/test/sessions/evict", (req, res) => {
      const sessionIds = Array.isArray(req.body?.session_ids) ? req.body.session_ids : [];
      const evicted = [];
      for (const rawId of sessionIds) {
        const sessionId = String(rawId || "").trim();
        if (!sessionId) continue;
        if (!registry.sessions.has(sessionId)) continue;
        registry.evict(sessionId);
        evicted.push(sessionId);
      }
      res.json({
        evicted_session_ids: evicted,
        remaining_session_ids: registry.listSessionIds(),
      });
    });
  }

  app.post("/v1/chat/sessions", async (req, res) => {
    const { provider: providerId, language, user_id } = req.body || {};
    const requestedProvider = providerId ? String(providerId).toLowerCase() : "auto";
    if (requestedProvider !== "auto") {
      return res.status(400).json({ detail: "provider_not_supported" });
    }

    try {
      const sessionId = crypto.randomUUID();
      const session = {
        sessionId,
        userId: user_id ? String(user_id).trim() : null,
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
        questionCount: 0,
      };
      registry.create(session);

      log.info("session_create_success", {
        sessionId,
        userId: session.userId ?? null,
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
    try {
      const responsePayload = await executeMessageRequest({
        sessionId: req.params.sessionId,
        body: req.body,
      });
      log.verbose("api_response", {
        requestId: responsePayload.tool_trace_id,
        sessionId: req.params.sessionId,
        response: responsePayload,
      });
      res.json(responsePayload);
    } catch (err) {
      const mapped = mapMessageRequestError(err);
      res.status(mapped.status).json(mapped.body);
    }
  });

  app.post("/v1/chat/sessions/:sessionId/messages/stream", async (req, res) => {
    const responseFormat = normalizeResponseFormat(req.body?.response_format);
    if (responseFormat !== "structured") {
      return res.status(400).json({ detail: "invalid_response_format" });
    }

    res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    if (typeof res.flushHeaders === "function") res.flushHeaders();

    try {
      const responsePayload = await executeMessageRequest({
        sessionId: req.params.sessionId,
        body: req.body,
        onStage: (event) => {
          if (!res.writableEnded) writeSseEvent(res, { type: "stage", ...event });
        },
      });
      log.verbose("api_response", {
        requestId: responsePayload.tool_trace_id,
        sessionId: req.params.sessionId,
        response: responsePayload,
      });
      if (!res.writableEnded) {
        writeSseEvent(res, { type: "final", data: responsePayload });
        res.end();
      }
    } catch (err) {
      const mapped = mapMessageRequestError(err);
      if (!res.writableEnded) {
        writeSseEvent(res, { type: "error", status: mapped.status, detail: mapped.body?.detail || "message_failed" });
        res.end();
      }
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

  app.get("/v1/users/:userId/sessions", (req, res) => {
    if (!sessionStore) {
      return res.status(404).json({ detail: "session_persistence_not_enabled" });
    }
    const userId = String(req.params.userId || "").trim();
    if (!userId) {
      return res.status(400).json({ detail: "user_id_required" });
    }
    const sessions = sessionStore.listByUser(userId);
    res.json({ sessions });
  });

  async function start({ port = configuredPort, host = configuredHost } = {}) {
    if (stopped) {
      throw new Error("server_stopped");
    }
    if (httpServer) return httpServer;
    await new Promise((resolve, reject) => {
      const server = app.listen(port, host, () => {
        httpServer = server;
        log.info("server_listen", { port, provider: defaultProvider, model: defaultModel });
        resolve();
      });
      server.once("error", reject);
    });
    return httpServer;
  }

  async function stop() {
    if (stopped) return;
    stopped = true;
    const server = httpServer;
    httpServer = null;
    if (server) {
      await new Promise((resolve, reject) => {
        server.close((err) => {
          if (err) return reject(err);
          resolve();
        });
      });
    }
    registry.shutdown();
    sessionStore?.close();
    feedbackStore?.close();
    requestLogStore?.close();
  }

  function getBaseUrl() {
    const address = httpServer?.address();
    if (!address || typeof address === "string") return null;
    const host = address.address === "::" ? "127.0.0.1" : address.address;
    return `http://${host}:${address.port}`;
  }

  async function executeMessageRequest({ sessionId, body, onStage } = {}) {
    const requestId = crypto.randomUUID();
    const requestStartedAt = Date.now();
    const { role, content, filters: uiFilters } = body || {};
    const requestLogContext = {
      sessionId: sessionId || null,
      question: typeof content === "string" ? content : null,
      workflow: null,
      language: null,
      keywordModel: null,
      answerModel: null,
      provider: null,
      chunksRetrieved: null,
      toolCallsUsed: null,
      contentType: null,
      answer: null,
    };
    let requestLogWritten = false;
    let session = null;

    try {
      session = registry.get(sessionId);
      if (!session) {
        log.warn("message_session_not_found", { sessionId });
        const err = new Error("session_not_found");
        err.status = 404;
        err.detail = "session_not_found";
        throw err;
      }
      requestLogContext.sessionId = session.sessionId;

      if (session.busy) {
        log.warn("message_session_busy", { sessionId });
        const err = new Error("session_busy");
        err.status = 409;
        err.detail = "session_busy";
        throw err;
      }

      const responseFormat = normalizeResponseFormat(body?.response_format, { fallback: defaultResponseFormat });
      const fullCitationsParam = body?.full_citations;
      if (role !== "user" || !content) {
        log.warn("message_invalid", { sessionId });
        const err = new Error("invalid_message");
        err.status = 400;
        err.detail = "invalid_message";
        throw err;
      }
      if (!responseFormat) {
        log.warn("message_invalid_response_format", {
          sessionId,
          responseFormat: body?.response_format,
        });
        const err = new Error("invalid_response_format");
        err.status = 400;
        err.detail = "invalid_response_format";
        throw err;
      }

      if (
        shouldRejectForTokenLimit({
          currentTokens: session.tokenCount || 0,
          incomingText: content,
          limit: sessionTokenLimit,
          threshold: sessionTokenLimitThreshold,
        })
      ) {
        log.warn("session_token_limit_reached", { sessionId: session.sessionId, tokenCount: session.tokenCount });
        const err = new Error("token_limit_exhausted");
        err.status = 429;
        err.payload = {
          detail: "Token Limit Exhausted for the session. Please initiate a new session.",
          customer_message: "Please start a new chat for better answer accuracy.",
        };
        throw err;
      }

      session.busy = true;
      session.lastActivityAt = Date.now();
      session.messages.push({ role: "user", content });
      session.tokenCount = (session.tokenCount || 0) + estimateTokens(content);
      session.questionCount = (session.questionCount || 0) + 1;

      const questionIndex = session.questionCount;
      log.info("message_received", {
        requestId,
        questionIndex,
        sessionId: session.sessionId,
        request: { role, content, response_format: body?.response_format, filters: uiFilters || null },
      });
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

      const stageEmitter = createStageEmitter(onStage);
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
            responseFormat,
            fullCitationsParam,
            requestId,
            onStage: stageEmitter,
            requestLogContext,
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
            err_message: err?.message || String(err),
          });
          throw err;
        }
      };

      try {
        const response = await router.route(attemptWithModel);
        writeRequestLog({
          requestLogStore,
          requestId,
          requestStartedAt,
          requestLogContext,
          error: null,
        });
        requestLogWritten = true;
        return response;
      } catch (err) {
        log.error("message_failed", {
          requestId,
          sessionId: session.sessionId,
          err_message: err?.message || String(err),
          stack: err?.stack,
        });
        throw err;
      }
    } catch (err) {
      if (!requestLogWritten) {
        writeRequestLog({
          requestLogStore,
          requestId,
          requestStartedAt,
          requestLogContext,
          error: getRequestLogError(err),
        });
        requestLogWritten = true;
      }
      throw err;
    } finally {
      if (session) {
        session.busy = false;
      }
    }
  }

  function persistSession(session) {
    registry.save(session);
  }

  async function handleMessageWithProvider({
    provider,
    model,
    session,
    content,
    uiFilters,
    responseFormat,
    fullCitationsParam,
    requestId,
    onStage,
    requestLogContext,
  }) {
    requestLogContext.provider = model.provider;
    requestLogContext.keywordModel = model.id;
    log.info("model_prompt_root", {
      requestId,
      sessionId: session.sessionId,
      modelId: model.id,
      promptRoot: getPromptRootForModel({ modelId: model.id }),
    });
    const baseHistory = Array.isArray(session.conversationHistory) ? [...session.conversationHistory] : [];
    onStage?.("understanding");
    let keywordResult = await runKeywordExtraction({
      provider,
      question: content,
      sessionContext: {
        conversationHistory: baseHistory,
      },
      requestId,
      modelId: model.id,
    });
    if (testMode && String(content || "").includes("FORCE_FOLLOWUP")) {
      keywordResult = {
        ...keywordResult,
        is_followup: true,
      };
    }
    requestLogContext.workflow = keywordResult.workflow || null;
    requestLogContext.language = keywordResult.language || null;

    const normalizedUiFilters = normalizeUiFilters(uiFilters);
    requestLogContext.contentType = normalizedUiFilters?.content_type ?? requestLogContext.contentType;

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
      requestLogContext.answer = greeting;

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

      persistSession(session);

      return buildResponsePayload({
        responseFormat,
        answer: greeting,
        followUpQuestions: [],
        references: [],
        citations: [],
        provider: session.provider,
        requestId,
        warnings: null,
      });
    }

    onStage?.("searching");
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

    let {
      workflowName,
      chunks,
      toolCallsUsed,
      keywordResult: finalKeywordResult,
      keywordFixApplied,
    } = workflowOutcome;
    if (keywordFixApplied) {
      log.info("keyword_fix_applied", {
        requestId,
        sessionId: session.sessionId,
        workflow: finalKeywordResult.workflow,
      });
    }

    keywordResult = finalKeywordResult;
    requestLogContext.workflow = workflowName;
    requestLogContext.language = keywordResult.language || requestLogContext.language || null;
    requestLogContext.toolCallsUsed = Number.isFinite(toolCallsUsed) ? toolCallsUsed : null;
    requestLogContext.contentType =
      sanitizeContentType(keywordResult?.filters?.content_type) ||
      requestLogContext.contentType;

    const isMetadataWorkflow = workflowName === "metadata_question_v1";
    const metadataByRealId = isMetadataWorkflow ? {} : buildChunkMetadataMap(chunks);
    const cleanedChunks = isMetadataWorkflow ? (Array.isArray(chunks) ? chunks : []) : cleanChunks(chunks);
    requestLogContext.chunksRetrieved = cleanedChunks.length;
    log.info("context_prepared", {
      requestId,
      sessionId: session.sessionId,
      chunks: cleanedChunks.length,
    });
    const emptyTextCount = cleanedChunks.filter(
      (chunk) => !String(chunk?.t || "").trim()
    ).length;
    log.verbose("context_sample", {
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
      requestLogContext.answer = answerForOutput;

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

      persistSession(session);
      scheduleHistorySummary({ provider, session, requestId });

      log.info("answer_parsed", {
        requestId,
        sessionId: session.sessionId,
        answerLength: answerForOutput.length,
        referencesCount: 0,
        citationsCount: 0,
      });
      log.verbose("conversation_history_ids", {
        requestId,
        sessionId: session.sessionId,
        conversationHistoryIds: session.conversationHistory.map((entry) => entry?.id).filter(Boolean),
      });

      return buildResponsePayload({
        responseFormat,
        answer: answerForOutput,
        followUpQuestions: [],
        references: [],
        citations: [],
        provider: session.provider,
        requestId,
        warnings,
      });
    }
    if (isMetadataWorkflow) {
      log.verbose("metadata_context_for_llm", {
        requestId,
        sessionId: session.sessionId,
        asked_info: keywordResult.asked_info || [],
        context,
      });
    }

    onStage?.("preparing");
    requestLogContext.answerModel = model.id;
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
      responseFormat,
      fullCitations: fullCitationsParam,
    });

    const answerStatusRaw = String(answerPayload?.answer_status || "").trim().toLowerCase();
    const answerRaw = String(answerPayload?.answer || "");
    const isLegacyNoAnswer = answerRaw.trim() === "NO_ANSWER";
    const isNoAnswer = answerStatusRaw === "no_answer" || isLegacyNoAnswer;
    // Preserve model-authored no-answer explanations when provided. Only synthesize
    // the locale fallback when the model used the legacy NO_ANSWER sentinel or did
    // not provide any user-visible no-answer text.
    const shouldUseLocaleNoAnswerFallback = isLegacyNoAnswer || (isNoAnswer && !answerRaw.trim());
    const resolvedAnswer = shouldUseLocaleNoAnswerFallback
      ? getNoContextTextForLocale({
          language: keywordResult.language,
          script: keywordResult.script,
          isMetadata: isMetadataWorkflow,
        })
      : answerRaw;
    const fullCitationsEnabled =
      !isMetadataWorkflow &&
      (fullCitationsParam !== undefined && fullCitationsParam !== null
        ? Boolean(fullCitationsParam)
        : String(process.env.ENABLE_FULL_CHUNKS_IN_CITATIONS || "").toLowerCase() === "true");
    const expandedAnswer = fullCitationsEnabled
      ? expandChunkCitations(
          resolvedAnswer,
          buildChunkCitationMap(hashedChunks, session.chunkIdMap, metadataByRealId)
        )
      : resolvedAnswer;

    const cleanedRaw = cleanAnswerText({
      text: expandedAnswer,
      language: keywordResult.language,
      script: keywordResult.script,
    });
    const normalizedForParsing = normalizeAnswerTextForParsing(cleanedRaw);
    const cleaned = stripCitations(normalizedForParsing);

    const hashedChunkIds = extractChunkIds(hashedChunks);
    const scoring = !isNoAnswer && Array.isArray(answerPayload?.scoring) ? answerPayload.scoring : [];
    const scoredChunks = buildScoredChunks(scoring, hashedChunkIds);

    let answerForOutput;
    let followUpQuestions = [];
    let safeReferences = [];
    let safeCitations = [];

    const referenceCount = getWorkflowReferenceCount(workflowName, model.id);
    const structured = isNoAnswer
      ? { references: [], citations: [] }
      : buildStructuredReferencesFromMetadata({
          scoredChunks,
          maxReferences: referenceCount,
          hashToRealId: session.chunkIdMap,
          metadataByRealId,
          language: keywordResult.language,
        });

    if (responseFormat === "structured") {
      const { answer: answerWithoutFollowUps, followUpQuestions: extractedFollowUps } = extractFollowUpQuestionsFromAnswer(cleaned);
      followUpQuestions = isNoAnswer ? [] : sanitizeFollowUpQuestions(extractedFollowUps);
      safeReferences = sanitizeReferences(structured.references);
      safeCitations = sanitizeCitations(structured.citations);
      answerForOutput = normalizeAnswerTextForOutput(answerWithoutFollowUps);
    } else {
      // combined: append service-built references at the end of the answer
      const answerBody = isNoAnswer
        ? extractFollowUpQuestionsFromAnswer(cleaned).answer
        : cleaned;
      const answerWithRefs = isNoAnswer
        ? answerBody
        : appendReferencesSection(answerBody, structured.references, keywordResult.language);
      answerForOutput = normalizeAnswerTextForOutput(answerWithRefs);
    }
    requestLogContext.answer = answerForOutput;

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
        chunk_ids: isNoAnswer ? [] : (scoredChunks.length ? scoredChunks.map((entry) => entry.chunk_id) : hashedChunkIds),
        chunk_scores: scoredChunks,
      },
    ];

    session.messages.push({ role: "assistant", content: answerForOutput });
    session.tokenCount = (session.tokenCount || 0) + estimateTokens(answerForOutput);
    session.lastActivityAt = Date.now();
    session.conversationHistory = updatedHistory;
    session.provider = model.provider;
    session.model = model.id;

    persistSession(session);
    scheduleHistorySummary({ provider, session, requestId });

    log.verbose("conversation_history_ids", {
      requestId,
      sessionId: session.sessionId,
      conversationHistoryIds: session.conversationHistory.map((entry) => entry?.id).filter(Boolean),
    });

    return buildResponsePayload({
      responseFormat,
      answer: answerForOutput,
      followUpQuestions,
      references: safeReferences,
      citations: safeCitations,
      provider: session.provider,
      requestId,
      warnings: warnings.length ? warnings : null,
    });
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
        persistSession(session);
      } catch (err) {
        log.warn("history_summary_failed", {
          requestId,
          message: err?.message || String(err),
        });
      }
    });
  }

  return { start, stop, getBaseUrl };
}

function cleanSessionDbForTest({ enabled, dbPath }) {
  if (!enabled) return;
  if (!dbPath) {
    log.warn("session_store_test_cleanup_skipped", {
      reason: "no_db_path",
    });
    return;
  }
  for (const target of [dbPath, `${dbPath}-wal`, `${dbPath}-shm`]) {
    try {
      fs.rmSync(target, { force: true });
    } catch (err) {
      log.warn("session_store_test_cleanup_failed", {
        target,
        message: err?.message || String(err),
      });
    }
  }
  log.info("session_store_test_cleanup_complete", {
    dbPath,
  });
}

function writeRequestLog({ requestLogStore, requestId, requestStartedAt, requestLogContext, error }) {
  if (!requestLogStore || !requestId) return;
  requestLogStore.upsert({
    requestId,
    sessionId: requestLogContext.sessionId ?? null,
    workflow: requestLogContext.workflow ?? null,
    language: requestLogContext.language ?? null,
    latencyMs: Date.now() - requestStartedAt,
    error: error || null,
    createdAt: requestStartedAt,
    details: {
      question: requestLogContext.question ?? null,
      keyword_model: requestLogContext.keywordModel ?? null,
      answer_model: requestLogContext.answerModel ?? null,
      provider: requestLogContext.provider ?? null,
      chunks_retrieved: requestLogContext.chunksRetrieved ?? null,
      tool_calls_used: requestLogContext.toolCallsUsed ?? null,
      content_type: requestLogContext.contentType ?? null,
      answer: requestLogContext.answer ?? null,
    },
  });
}

function getRequestLogError(err) {
  if (!err) return null;
  if (typeof err?.detail === "string" && err.detail) return err.detail;
  if (typeof err?.payload?.detail === "string" && err.payload.detail) return err.payload.detail;
  if (typeof err?.message === "string" && err.message) return err.message;
  return String(err);
}

function mapMessageRequestError(err) {
  if (err?.payload && Number.isFinite(err?.status)) {
    return { status: err.status, body: err.payload };
  }
  if (Number.isFinite(err?.status) && err?.detail) {
    return { status: err.status, body: { detail: err.detail } };
  }

  const message = err?.message || String(err);
  if (err?.code === "service_unavailable") {
    return { status: 503, body: { detail: "service_unavailable" } };
  }
  if (Number.isFinite(err?.status) && err.status >= 400 && err.status < 500) {
    return { status: err.status, body: { detail: "client_error" } };
  }
  if (message.includes("External API")) {
    return { status: 502, body: { detail: "tool_backend_error" } };
  }
  if (message.includes("OpenAI")) {
    return { status: 503, body: { detail: "provider_unavailable" } };
  }
  if (
    message.includes("Service Unavailable") ||
    message.includes("UNAVAILABLE") ||
    message.includes("model is currently experiencing high demand")
  ) {
    return { status: 503, body: { detail: "model_temporarily_unavailable" } };
  }
  if (message.includes("tool_call_budget_exceeded")) {
    return { status: 429, body: { detail: "tool_call_budget_exceeded" } };
  }
  return { status: 500, body: { detail: "message_failed" } };
}

function resolveSessionTokenLimit({ explicitLimit, defaultProvider, defaultModel } = {}) {
  if (explicitLimit !== undefined && explicitLimit !== null) {
    const value = Number(explicitLimit);
    if (Number.isFinite(value) && value > 0) return value;
  }
  const raw = process.env.LLM_SESSION_TOKEN_LIMIT;
  if (raw !== undefined && raw !== null && String(raw).trim() !== "") {
    const value = Number(raw);
    if (Number.isFinite(value) && value > 0) return value;
  }
  const configured = getSessionTokenLimit(defaultProvider, defaultModel);
  if (Number.isFinite(configured) && configured > 0) return configured;
  log.warn("session_token_limit_unset", { provider: defaultProvider, model: defaultModel });
  return 0;
}

function createStageEmitter(onStage) {
  if (typeof onStage !== "function") return null;
  const emitted = new Set();
  return (stage) => {
    const key = String(stage || "").trim();
    if (!key || emitted.has(key) || !({ understanding: 1, searching: 1, preparing: 1 }[key])) return;
    emitted.add(key);
    onStage({ stage: key, label: { understanding: "Understanding your question", searching: "Searching through our scriptures", preparing: "Preparing answer" }[key] });
  };
}

function writeSseEvent(res, payload) {
  res.write(`data: ${JSON.stringify(payload)}\n\n`);
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

function normalizeResponseFormat(value, { fallback = null } = {}) {
  const raw = value === undefined || value === null || String(value).trim() === "" ? fallback : value;
  const normalized = String(raw || "").trim().toLowerCase();
  if (normalized === "structured") return "structured";
  if (normalized === "combined" || normalized === "compact") return "combined";
  return null;
}

function buildResponsePayload({
  responseFormat,
  answer,
  followUpQuestions,
  references,
  citations,
  provider,
  requestId,
  warnings,
}) {
  const payload = {
    answer,
    provider,
    tool_trace_id: requestId,
    warnings,
  };
  if (responseFormat === "structured") {
    payload.follow_up_questions = Array.isArray(followUpQuestions) ? followUpQuestions : [];
    payload.references = references;
    payload.citations = citations;
  }
  return payload;
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
    series: chunk.series || metadata.series || "",
    series_number: chunk.series_number || metadata.series_number || "",
    gatha: chunk.gatha || metadata.gatha || "",
    kalash: chunk.kalash || metadata.kalash || "",
    shlok: chunk.shlok || metadata.shlok || "",
    dohra: chunk.dohra || metadata.dohra || "",
    volume: chunk.volume ?? metadata.volume ?? null,
    series_start_date: chunk.series_start_date || metadata.series_start_date || "",
    series_end_date: chunk.series_end_date || metadata.series_end_date || "",
    page_number: chunk.page_number ?? metadata.page_number ?? null,
    pdf_page_number: chunk.pdf_page_number ?? metadata.pdf_page_number ?? null,
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

function readBooleanEnv(name) {
  return String(process.env[name] || "").toLowerCase() === "true";
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

// Auto-start when run as the main module
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  createServer().start().catch((err) => {
    console.error("Failed to start server:", err);
    process.exit(1);
  });
}
