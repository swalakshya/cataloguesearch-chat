import fs from "node:fs";
import path from "node:path";

import Database from "better-sqlite3";

import { log } from "../utils/log.js";

export class RequestLogStore {
  constructor(dbPath) {
    this.dbPath = String(dbPath || "").trim();
    if (!this.dbPath) {
      throw new Error("CHAT_DB_PATH is required");
    }

    fs.mkdirSync(path.dirname(this.dbPath), { recursive: true });

    this.db = new Database(this.dbPath);
    this.db.pragma("journal_mode = DELETE");
    this.db.pragma("synchronous = NORMAL");

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS request_logs (
        request_id   TEXT PRIMARY KEY,
        session_id   TEXT,
        workflow     TEXT,
        language     TEXT,
        latency_ms   INTEGER,
        error        TEXT,
        created_at   INTEGER NOT NULL,
        details_json TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_request_logs_created_at
        ON request_logs(created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_request_logs_session_id
        ON request_logs(session_id);
    `);

    this.upsertStmt = this.db.prepare(`
      INSERT INTO request_logs (
        request_id,
        session_id,
        workflow,
        language,
        latency_ms,
        error,
        created_at,
        details_json
      ) VALUES (
        @request_id,
        @session_id,
        @workflow,
        @language,
        @latency_ms,
        @error,
        @created_at,
        @details_json
      )
      ON CONFLICT(request_id) DO UPDATE SET
        session_id = excluded.session_id,
        workflow = excluded.workflow,
        language = excluded.language,
        latency_ms = excluded.latency_ms,
        error = excluded.error,
        created_at = excluded.created_at,
        details_json = excluded.details_json
    `);
    this.getRequestLogStmt = this.db.prepare(`
      SELECT name
      FROM sqlite_master
      WHERE type = 'table' AND name = 'sessions'
    `);
    this.clearStmt = this.db.prepare(`
      DELETE FROM request_logs
    `);
  }

  upsert(record) {
    if (!record?.requestId) return;
    this.upsertStmt.run({
      request_id: record.requestId,
      session_id: record.sessionId ?? null,
      workflow: record.workflow ?? null,
      language: record.language ?? null,
      latency_ms: Number.isFinite(record.latencyMs) ? Math.round(record.latencyMs) : null,
      error: record.error ? String(record.error) : null,
      created_at: Number(record.createdAt) || Date.now(),
      details_json: record.details ? JSON.stringify(record.details) : null,
    });
    log.info("request_log_stored", {
      requestId: record.requestId,
      sessionId: record.sessionId ?? null,
      workflow: record.workflow ?? null,
      language: record.language ?? null,
      hasError: Boolean(record.error),
    });
  }

  listSummaries({
    from,
    to,
    requestId,
    sessionId,
    userId,
    workflow,
    language,
    status = "all",
    limit = 50,
    offset = 0,
  } = {}) {
    const where = [];
    const params = [];
    const hasSessionsTable = this.#hasSessionsTable();

    if (Number.isFinite(from)) {
      where.push("rl.created_at >= ?");
      params.push(Number(from));
    }
    if (Number.isFinite(to)) {
      where.push("rl.created_at <= ?");
      params.push(Number(to));
    }
    if (requestId) {
      where.push("rl.request_id = ?");
      params.push(String(requestId));
    }
    if (sessionId) {
      where.push("rl.session_id = ?");
      params.push(String(sessionId));
    }
    if (userId) {
      if (!hasSessionsTable) {
        return { rows: [], total: 0 };
      }
      where.push("s.user_id = ?");
      params.push(String(userId));
    }
    if (workflow) {
      where.push("rl.workflow = ?");
      params.push(String(workflow));
    }
    if (language) {
      where.push("rl.language = ?");
      params.push(String(language));
    }
    if (status === "failed") {
      where.push("rl.error IS NOT NULL AND rl.error != ''");
    } else if (status === "success") {
      where.push("(rl.error IS NULL OR rl.error = '')");
    }

    const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
    const joinSql = hasSessionsTable
      ? "LEFT JOIN sessions s ON s.session_id = rl.session_id"
      : "";
    const userIdSelect = hasSessionsTable ? "s.user_id AS user_id," : "NULL AS user_id,";
    const listStmt = this.db.prepare(`
      SELECT rl.request_id, rl.session_id, ${userIdSelect} rl.latency_ms, rl.error, rl.created_at, rl.details_json
      FROM request_logs rl
      ${joinSql}
      ${whereSql}
      ORDER BY rl.created_at DESC
      LIMIT ? OFFSET ?
    `);
    const countStmt = this.db.prepare(`
      SELECT COUNT(*) AS total
      FROM request_logs rl
      ${joinSql}
      ${whereSql}
    `);

    const safeLimit = Math.max(0, Number(limit) || 0);
    const safeOffset = Math.max(0, Number(offset) || 0);
    const rows = listStmt.all(...params, safeLimit, safeOffset);
    const total = countStmt.get(...params).total;

    return {
      rows: rows.map(deserializeSummary),
      total,
    };
  }

  getByRequestId(requestId) {
    const normalizedRequestId = String(requestId || "").trim();
    if (!normalizedRequestId) return null;

    const hasSessionsTable = this.#hasSessionsTable();
    const joinSql = hasSessionsTable
      ? "LEFT JOIN sessions s ON s.session_id = rl.session_id"
      : "";
    const userIdSelect = hasSessionsTable ? "s.user_id AS user_id," : "NULL AS user_id,";
    const stmt = this.db.prepare(`
      SELECT rl.request_id, rl.session_id, ${userIdSelect}
             rl.workflow, rl.language, rl.latency_ms, rl.error, rl.created_at, rl.details_json
      FROM request_logs rl
      ${joinSql}
      WHERE rl.request_id = ?
      LIMIT 1
    `);
    const row = stmt.get(normalizedRequestId);
    return row ? deserializeDetail(row) : null;
  }

  clear() {
    const result = this.clearStmt.run();
    log.info("request_log_store_cleared", {
      deletedCount: Number(result?.changes || 0),
    });
  }

  close() {
    this.db.close();
  }

  #hasSessionsTable() {
    return Boolean(this.getRequestLogStmt.get());
  }
}

function deserializeSummary(row) {
  const details = tryParseJson(row.details_json);
  return {
    request_id: row.request_id,
    session_id: row.session_id,
    user_id: row.user_id ?? null,
    question: details?.question ?? null,
    latency_ms: row.latency_ms,
    status: row.error ? "failed" : "success",
    created_at: row.created_at,
  };
}

function deserializeDetail(row) {
  return {
    request_id: row.request_id,
    session_id: row.session_id,
    user_id: row.user_id ?? null,
    workflow: row.workflow,
    language: row.language,
    latency_ms: row.latency_ms,
    error: row.error,
    created_at: row.created_at,
    details: tryParseJson(row.details_json),
  };
}

function tryParseJson(value) {
  if (!value) return null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}
