import fs from "node:fs";
import readline from "node:readline";

import { parseJsonStrict } from "../utils/json.js";
import { RequestLogStore } from "./request_log_store.js";

export async function migrateRequestLogs({ dbPath, logPaths, dryRun = false } = {}) {
  const normalizedPaths = Array.isArray(logPaths)
    ? logPaths.map((value) => String(value || "").trim()).filter(Boolean)
    : [];
  if (!normalizedPaths.length) {
    throw new Error("At least one log file path is required");
  }

  const requestStates = new Map();
  let linesRead = 0;
  let parsedLines = 0;
  let skippedLines = 0;

  for (const logPath of normalizedPaths) {
    const fileStats = fs.statSync(logPath);
    if (!fileStats.isFile()) {
      throw new Error(`Log path is not a file: ${logPath}`);
    }

    const input = fs.createReadStream(logPath, { encoding: "utf8" });
    const rl = readline.createInterface({ input, crlfDelay: Infinity });
    for await (const line of rl) {
      linesRead += 1;
      const trimmed = String(line || "").trim();
      if (!trimmed) continue;

      let record;
      try {
        record = JSON.parse(trimmed);
      } catch {
        skippedLines += 1;
        continue;
      }

      const requestId = sanitizeString(record.requestId);
      if (!requestId) continue;

      parsedLines += 1;
      const state = getOrCreateState(requestStates, requestId);
      applyRecordToState(state, record);
    }
  }

  const records = Array.from(requestStates.values())
    .map(finalizeState)
    .filter(Boolean);

  if (!dryRun) {
    const store = new RequestLogStore(dbPath);
    try {
      for (const record of records) {
        store.upsert(record);
      }
    } finally {
      store.close();
    }
  }

  return {
    filesProcessed: normalizedPaths.length,
    linesRead,
    parsedLines,
    skippedLines,
    recordsPrepared: records.length,
    recordsWritten: dryRun ? 0 : records.length,
    dryRun,
  };
}

export function buildRequestLogRecordsFromLines(lines) {
  const requestStates = new Map();
  for (const line of Array.isArray(lines) ? lines : []) {
    const trimmed = String(line || "").trim();
    if (!trimmed) continue;
    let record;
    try {
      record = JSON.parse(trimmed);
    } catch {
      continue;
    }
    const requestId = sanitizeString(record.requestId);
    if (!requestId) continue;
    const state = getOrCreateState(requestStates, requestId);
    applyRecordToState(state, record);
  }
  return Array.from(requestStates.values()).map(finalizeState).filter(Boolean);
}

function getOrCreateState(states, requestId) {
  let state = states.get(requestId);
  if (state) return state;

  state = {
    requestId,
    sessionId: null,
    question: null,
    workflow: null,
    language: null,
    contentType: null,
    keywordModel: null,
    answerModel: null,
    provider: null,
    answer: null,
    chunksRetrieved: null,
    toolCallsUsed: 0,
    hasToolCalls: false,
    error: null,
    createdAt: null,
    completedAt: null,
    lastAttemptModel: null,
    lastAttemptProvider: null,
  };
  states.set(requestId, state);
  return state;
}

function applyRecordToState(state, record) {
  const ts = parseTimestamp(record.ts);
  if (ts !== null) {
    state.createdAt = state.createdAt === null ? ts : Math.min(state.createdAt, ts);
    state.completedAt = state.completedAt === null ? ts : Math.max(state.completedAt, ts);
  }

  if (sanitizeString(record.sessionId)) {
    state.sessionId = sanitizeString(record.sessionId);
  }

  switch (record.message) {
    case "message_received":
      state.question = sanitizeString(record.request?.content) || state.question;
      state.sessionId = sanitizeString(record.sessionId) || state.sessionId;
      state.contentType = mergeContentTypes(state.contentType, record.request?.filters?.content_type);
      break;
    case "keyword_extract_llm_response":
      applyKeywordExtractionResponse(state, record.response);
      break;
    case "keyword_extraction_complete":
      state.workflow = sanitizeString(record.workflow) || state.workflow;
      state.keywordModel = sanitizeString(record.modelId) || state.keywordModel;
      state.sessionId = sanitizeString(record.sessionId) || state.sessionId;
      break;
    case "model_routing_attempt":
      state.lastAttemptModel = sanitizeString(record.modelId) || state.lastAttemptModel;
      state.lastAttemptProvider = sanitizeString(record.provider) || state.lastAttemptProvider;
      break;
    case "model_routing_success":
      state.answerModel = sanitizeString(record.modelId) || state.answerModel;
      state.provider = sanitizeString(record.provider) || state.provider;
      state.keywordModel = state.keywordModel || state.answerModel;
      break;
    case "model_routing_failure":
      state.lastAttemptModel = sanitizeString(record.modelId) || state.lastAttemptModel;
      state.lastAttemptProvider = sanitizeString(record.provider) || state.lastAttemptProvider;
      break;
    case "workflow_complete":
      state.workflow = sanitizeString(record.workflow) || state.workflow;
      if (Number.isFinite(record.retrievedChunks)) {
        state.chunksRetrieved = Number(record.retrievedChunks);
      }
      if (Number.isFinite(record.toolCallsUsed)) {
        state.toolCallsUsed += Number(record.toolCallsUsed);
        state.hasToolCalls = true;
      }
      break;
    case "context_prepared":
      if (Number.isFinite(record.chunks)) {
        state.chunksRetrieved = Number(record.chunks);
      }
      break;
    case "external_api_request":
      if (sanitizeString(record.path) === "/api/agent/search") {
        state.contentType = mergeContentTypes(state.contentType, record.payload?.content_type);
      }
      break;
    case "api_response":
      state.sessionId = sanitizeString(record.sessionId) || state.sessionId;
      state.provider = sanitizeString(record.response?.provider) || state.provider;
      state.answer = sanitizeString(record.response?.answer) || state.answer;
      state.error = null;
      break;
    case "message_failed":
      state.sessionId = sanitizeString(record.sessionId) || state.sessionId;
      state.error = sanitizeString(record.err_message) || state.error;
      break;
    default:
      break;
  }
}

function applyKeywordExtractionResponse(state, rawResponse) {
  const raw = sanitizeString(rawResponse);
  if (!raw) return;
  let parsed;
  try {
    parsed = parseJsonStrict(raw);
  } catch {
    return;
  }
  state.language = sanitizeString(parsed.language) || state.language;
  state.workflow = sanitizeString(parsed.workflow) || state.workflow;
  state.contentType = mergeContentTypes(state.contentType, parsed.filters?.content_type);
}

function finalizeState(state) {
  const createdAt = state.createdAt ?? state.completedAt;
  if (createdAt === null) return null;

  const completedAt = state.completedAt ?? createdAt;
  const latencyMs = completedAt >= createdAt ? completedAt - createdAt : null;
  const keywordModel = state.keywordModel || state.answerModel || state.lastAttemptModel || null;
  const provider = state.provider || state.lastAttemptProvider || null;

  return {
    requestId: state.requestId,
    sessionId: state.sessionId,
    workflow: state.workflow,
    language: state.language,
    latencyMs,
    error: state.error,
    createdAt,
    details: {
      question: state.question,
      keyword_model: keywordModel,
      answer_model: state.answerModel,
      provider,
      chunks_retrieved: state.chunksRetrieved,
      tool_calls_used: state.hasToolCalls ? state.toolCallsUsed : null,
      content_type: state.contentType,
      answer: state.answer,
    },
  };
}

function parseTimestamp(value) {
  const parsed = Date.parse(String(value || ""));
  return Number.isFinite(parsed) ? parsed : null;
}

function sanitizeString(value) {
  if (value === undefined || value === null) return null;
  const normalized = String(value).trim();
  return normalized || null;
}

function mergeContentTypes(current, incoming) {
  const merged = [];
  const seen = new Set();

  for (const value of [...normalizeContentTypes(current), ...normalizeContentTypes(incoming)]) {
    if (seen.has(value)) continue;
    seen.add(value);
    merged.push(value);
  }

  return merged.length ? merged : null;
}

function normalizeContentTypes(value) {
  const rawValues = Array.isArray(value) ? value : typeof value === "string" ? value.split(",") : [];
  return rawValues
    .map((entry) => sanitizeString(entry))
    .filter(Boolean);
}
