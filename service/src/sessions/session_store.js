import fs from "node:fs";
import path from "node:path";

import Database from "better-sqlite3";

import { log } from "../utils/log.js";

const SESSION_SCHEMA_VERSION = 1;

export class SessionStore {
  constructor(dbPath) {
    this.dbPath = String(dbPath || "").trim();
    if (!this.dbPath) {
      throw new Error("SESSION_DB_PATH is required");
    }

    fs.mkdirSync(path.dirname(this.dbPath), { recursive: true });

    this.db = new Database(this.dbPath);
    this.db.pragma("journal_mode = DELETE");
    this.db.pragma("synchronous = NORMAL");

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS sessions (
        session_id TEXT PRIMARY KEY,
        user_id TEXT,
        language TEXT NOT NULL DEFAULT 'hi',
        message_count INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL,
        last_activity_at INTEGER NOT NULL,
        data TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_sessions_last_activity_at
        ON sessions(last_activity_at);
      CREATE INDEX IF NOT EXISTS idx_sessions_user_id
        ON sessions(user_id);
    `);

    this.upsertStmt = this.db.prepare(`
      INSERT INTO sessions (
        session_id,
        user_id,
        language,
        message_count,
        created_at,
        last_activity_at,
        data
      ) VALUES (
        @session_id,
        @user_id,
        @language,
        @message_count,
        @created_at,
        @last_activity_at,
        @data
      )
      ON CONFLICT(session_id) DO UPDATE SET
        user_id = excluded.user_id,
        language = excluded.language,
        message_count = excluded.message_count,
        created_at = excluded.created_at,
        last_activity_at = excluded.last_activity_at,
        data = excluded.data
    `);
    this.restoreStmt = this.db.prepare(`
      SELECT session_id, user_id, message_count, created_at, last_activity_at, data
      FROM sessions
      WHERE session_id = ?
    `);
    this.listByUserStmt = this.db.prepare(`
      SELECT session_id, language, message_count, last_activity_at
      FROM sessions
      WHERE user_id = ?
      ORDER BY last_activity_at DESC
    `);
    this.deleteStmt = this.db.prepare(`
      DELETE FROM sessions
      WHERE session_id = ?
    `);
    this.clearStmt = this.db.prepare(`
      DELETE FROM sessions
    `);
  }

  upsert(session) {
    if (!session?.sessionId) return;
    const record = toPersistedRecord(session);
    this.upsertStmt.run({
      session_id: session.sessionId,
      user_id: record.userId,
      language: record.language || "hi",
      message_count: Array.isArray(record.messages) ? record.messages.length : 0,
      created_at: Number(record.createdAt) || Date.now(),
      last_activity_at: Number(record.lastActivityAt) || Date.now(),
      data: JSON.stringify(record),
    });
    log.info("session_persisted", {
      sessionId: session.sessionId,
      userId: record.userId ?? null,
      messageCount: Array.isArray(record.messages) ? record.messages.length : 0,
      lastActivityAt: record.lastActivityAt,
    });
  }

  restore(sessionId) {
    const row = this.restoreStmt.get(sessionId);
    if (!row) return null;

    let data;
    try {
      data = JSON.parse(row.data);
    } catch (err) {
      log.warn("session_restore_parse_failed", {
        sessionId,
        message: err?.message || String(err),
      });
      return null;
    }

    return fromPersistedRecord(row, data);
  }

  listByUser(userId) {
    if (!userId) return [];
    const rows = this.listByUserStmt.all(userId);
    return rows.map((row) => ({
      session_id: row.session_id,
      language: row.language,
      message_count: row.message_count,
      last_activity_at: row.last_activity_at,
    }));
  }

  delete(sessionId) {
    if (!sessionId) return;
    const result = this.deleteStmt.run(sessionId);
    log.info("session_store_deleted", {
      sessionId,
      deleted: Number(result?.changes || 0) > 0,
    });
  }

  clear() {
    const result = this.clearStmt.run();
    log.info("session_store_cleared", {
      deletedCount: Number(result?.changes || 0),
    });
  }

  close() {
    this.db.close();
  }
}

function toPersistedRecord(session) {
  return {
    schemaVersion: SESSION_SCHEMA_VERSION,
    sessionId: session.sessionId,
    userId: session.userId ?? null,
    provider: normalizeProvider(session.provider),
    model: session.model ?? null,
    language: session.language || "hi",
    createdAt: Number(session.createdAt) || Date.now(),
    lastActivityAt: Number(session.lastActivityAt) || Date.now(),
    messages: Array.isArray(session.messages) ? session.messages : [],
    tokenCount: Number(session.tokenCount) || 0,
    chunkIdMap: isPlainObject(session.chunkIdMap) ? session.chunkIdMap : {},
    chunkIdReverseMap: isPlainObject(session.chunkIdReverseMap) ? session.chunkIdReverseMap : {},
    chunkIdCounter: Number(session.chunkIdCounter) || 0,
    conversationHistory: Array.isArray(session.conversationHistory) ? session.conversationHistory : [],
  };
}

function fromPersistedRecord(row, data) {
  const createdAt = Number(row.created_at) || Number(data?.createdAt) || Date.now();
  const lastActivityAt = Number(row.last_activity_at) || Number(data?.lastActivityAt) || createdAt;

  return {
    sessionId: row.session_id,
    userId: data?.userId ?? row.user_id ?? null,
    provider: typeof data?.provider === "string" ? data.provider : "auto",
    providerSessionId: null,
    language: typeof data?.language === "string" && data.language ? data.language : "hi",
    model: data?.model ?? null,
    createdAt,
    lastActivityAt,
    messages: Array.isArray(data?.messages) ? data.messages : [],
    tokenCount: Number(data?.tokenCount) || 0,
    chunkIdMap: isPlainObject(data?.chunkIdMap) ? data.chunkIdMap : {},
    chunkIdReverseMap: isPlainObject(data?.chunkIdReverseMap) ? data.chunkIdReverseMap : {},
    chunkIdCounter: Number(data?.chunkIdCounter) || 0,
    conversationHistory: Array.isArray(data?.conversationHistory) ? data.conversationHistory : [],
    busy: false,
  };
}

function normalizeProvider(provider) {
  if (typeof provider === "string" && provider) return provider;
  if (typeof provider?.name === "function") {
    const name = provider.name();
    return typeof name === "string" && name ? name : "auto";
  }
  return "auto";
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
