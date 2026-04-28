import fs from "node:fs";
import path from "node:path";

import Database from "better-sqlite3";

import { log } from "../utils/log.js";

const PROCESSING_TTL_MS = 15 * 60 * 1000; // 15 min
const DONE_TTL_MS = 24 * 60 * 60 * 1000;  // 24 h

export class MessageJobStore {
  constructor(dbPath) {
    this.dbPath = String(dbPath || "").trim();
    if (!this.dbPath) throw new Error("dbPath required for MessageJobStore");

    fs.mkdirSync(path.dirname(this.dbPath), { recursive: true });

    this.db = new Database(this.dbPath);
    this.db.pragma("journal_mode = DELETE");
    this.db.pragma("synchronous = NORMAL");

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS message_jobs (
        message_id   TEXT PRIMARY KEY,
        session_id   TEXT NOT NULL,
        status       TEXT NOT NULL DEFAULT 'processing',
        request_hash TEXT NOT NULL,
        result_json  TEXT,
        events_json  TEXT,
        created_at   INTEGER NOT NULL,
        expires_at   INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_message_jobs_session_id
        ON message_jobs(session_id);
    `);
    // Migrate existing DBs that don't yet have events_json column
    try { this.db.exec(`ALTER TABLE message_jobs ADD COLUMN events_json TEXT`); } catch { /* already exists */ }

    this.insertStmt = this.db.prepare(`
      INSERT INTO message_jobs
        (message_id, session_id, status, request_hash, result_json, events_json, created_at, expires_at)
      VALUES
        (@message_id, @session_id, @status, @request_hash, @result_json, @events_json, @created_at, @expires_at)
      ON CONFLICT(message_id) DO NOTHING
    `);
    this.getStmt = this.db.prepare(`
      SELECT * FROM message_jobs WHERE message_id = ? AND expires_at > ?
    `);
    this.updateStmt = this.db.prepare(`
      UPDATE message_jobs
      SET status = @status, result_json = @result_json, events_json = @events_json, expires_at = @expires_at
      WHERE message_id = @message_id
    `);
    this.clearStmt = this.db.prepare(`DELETE FROM message_jobs`);
  }

  create({ messageId, sessionId, requestHash }) {
    const now = Date.now();
    this.insertStmt.run({
      message_id: messageId,
      session_id: sessionId,
      status: "processing",
      request_hash: requestHash,
      result_json: null,
      events_json: null,
      created_at: now,
      expires_at: now + PROCESSING_TTL_MS,
    });
    log.info("message_job_created", { messageId, sessionId });
  }

  get(messageId) {
    return this.getStmt.get(messageId, Date.now()) || null;
  }

  setDone(messageId, result, events = []) {
    this.updateStmt.run({
      message_id: messageId,
      status: "done",
      result_json: JSON.stringify(result),
      events_json: JSON.stringify(events),
      expires_at: Date.now() + DONE_TTL_MS,
    });
    log.info("message_job_done", { messageId });
  }

  setError(messageId, errorPayload, events = []) {
    this.updateStmt.run({
      message_id: messageId,
      status: "error",
      result_json: JSON.stringify(errorPayload),
      events_json: JSON.stringify(events),
      expires_at: Date.now() + DONE_TTL_MS,
    });
    log.warn("message_job_error", { messageId, ...errorPayload });
  }

  getEvents(messageId) {
    const job = this.get(messageId);
    if (!job || !job.events_json) return [];
    try { return JSON.parse(job.events_json); } catch { return []; }
  }

  clear() {
    this.clearStmt.run();
  }

  close() {
    this.db.close();
  }
}

// In-memory fallback when no DB path is configured (tests, dev without DB)
export class MemoryMessageJobStore {
  constructor() {
    this.jobs = new Map();
  }

  create({ messageId, sessionId, requestHash }) {
    if (this.jobs.has(messageId)) return;
    this.jobs.set(messageId, {
      message_id: messageId,
      session_id: sessionId,
      status: "processing",
      request_hash: requestHash,
      result_json: null,
      expires_at: Date.now() + PROCESSING_TTL_MS,
    });
  }

  get(messageId) {
    const job = this.jobs.get(messageId);
    if (!job) return null;
    if (job.expires_at < Date.now()) {
      this.jobs.delete(messageId);
      return null;
    }
    return job;
  }

  setDone(messageId, result, events = []) {
    const job = this.jobs.get(messageId);
    if (!job) return;
    job.status = "done";
    job.result_json = JSON.stringify(result);
    job.events_json = JSON.stringify(events);
    job.expires_at = Date.now() + DONE_TTL_MS;
  }

  setError(messageId, errorPayload, events = []) {
    const job = this.jobs.get(messageId);
    if (!job) return;
    job.status = "error";
    job.result_json = JSON.stringify(errorPayload);
    job.events_json = JSON.stringify(events);
    job.expires_at = Date.now() + DONE_TTL_MS;
  }

  getEvents(messageId) {
    const job = this.get(messageId);
    if (!job || !job.events_json) return [];
    try { return JSON.parse(job.events_json); } catch { return []; }
  }

  clear() {
    this.jobs.clear();
  }

  close() {}
}
