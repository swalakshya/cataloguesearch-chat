import fs from "node:fs";
import path from "node:path";

import Database from "better-sqlite3";

import { log } from "../utils/log.js";

export class FeedbackStore {
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
      CREATE TABLE IF NOT EXISTS feedback (
        id                TEXT PRIMARY KEY,
        answer_key        TEXT NOT NULL,
        vote              TEXT NOT NULL CHECK(vote IN ('helpful','not_helpful')),
        status            TEXT NOT NULL DEFAULT 'new' CHECK(status IN ('new','archived')),

        user_name         TEXT,
        user_email        TEXT,
        user_phone        TEXT,
        request_id        TEXT,

        question          TEXT NOT NULL,
        answer            TEXT NOT NULL,
        references_json   TEXT,
        citations_json    TEXT,

        message           TEXT,

        moderator_comment TEXT,
        reviewed_at       INTEGER,

        created_at        INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_feedback_answer_key
        ON feedback(answer_key);
      CREATE INDEX IF NOT EXISTS idx_feedback_status
        ON feedback(status);
      CREATE INDEX IF NOT EXISTS idx_feedback_created_at
        ON feedback(created_at DESC);
    `);

    this.insertStmt = this.db.prepare(`
      INSERT INTO feedback (
        id, answer_key, vote, status,
        user_name, user_email, user_phone, request_id,
        question, answer, references_json, citations_json,
        message, created_at
      ) VALUES (
        @id, @answer_key, @vote, 'new',
        @user_name, @user_email, @user_phone, @request_id,
        @question, @answer, @references_json, @citations_json,
        @message, @created_at
      )
    `);

    this.existsStmt = this.db.prepare(`
      SELECT id FROM feedback
      WHERE answer_key = ? AND request_id = ?
      LIMIT 1
    `);

    this.listStmt = this.db.prepare(`
      SELECT id, answer_key, vote, status, user_name, user_email, user_phone,
             request_id, question, answer, message, moderator_comment,
             reviewed_at, created_at
      FROM feedback
      ORDER BY created_at DESC
      LIMIT ? OFFSET ?
    `);

    this.listByStatusStmt = this.db.prepare(`
      SELECT id, answer_key, vote, status, user_name, user_email, user_phone,
             request_id, question, answer, message, moderator_comment,
             reviewed_at, created_at
      FROM feedback
      WHERE status = ?
      ORDER BY created_at DESC
      LIMIT ? OFFSET ?
    `);

    this.countStmt = this.db.prepare(`SELECT COUNT(*) as total FROM feedback`);
    this.countByStatusStmt = this.db.prepare(`SELECT COUNT(*) as total FROM feedback WHERE status = ?`);

    this.getByIdStmt = this.db.prepare(`
      SELECT * FROM feedback WHERE id = ?
    `);

    this.patchStmt = this.db.prepare(`
      UPDATE feedback
      SET status = @status,
          moderator_comment = @moderator_comment,
          reviewed_at = @reviewed_at
      WHERE id = @id
    `);
  }

  isDuplicate(answerKey, requestId) {
    if (!answerKey || !requestId) return false;
    return Boolean(this.existsStmt.get(answerKey, requestId));
  }

  insert(record) {
    this.insertStmt.run({
      id: record.id,
      answer_key: record.answerKey,
      vote: record.vote,
      user_name: record.userName ?? null,
      user_email: record.userEmail ?? null,
      user_phone: record.userPhone ?? null,
      request_id: record.requestId ?? null,
      question: record.question,
      answer: record.answer,
      references_json: record.references ? JSON.stringify(record.references) : null,
      citations_json: record.citations ? JSON.stringify(record.citations) : null,
      message: record.message ?? null,
      created_at: record.createdAt ?? Date.now(),
    });
    log.info("feedback_stored", {
      id: record.id,
      vote: record.vote,
      requestId: record.requestId ?? null,
    });
  }

  list({ status, limit = 50, offset = 0 } = {}) {
    const rows = status
      ? this.listByStatusStmt.all(status, limit, offset)
      : this.listStmt.all(limit, offset);
    const total = status
      ? this.countByStatusStmt.get(status).total
      : this.countStmt.get().total;
    return { rows: rows.map(deserialize), total };
  }

  getById(id) {
    const row = this.getByIdStmt.get(id);
    return row ? deserialize(row) : null;
  }

  patch(id, { status, moderatorComment }) {
    this.patchStmt.run({
      id,
      status,
      moderator_comment: moderatorComment ?? null,
      reviewed_at: Date.now(),
    });
    log.info("feedback_patched", { id, status });
  }

  close() {
    this.db.close();
  }
}

function deserialize(row) {
  return {
    id: row.id,
    answerKey: row.answer_key,
    vote: row.vote,
    status: row.status,
    userName: row.user_name,
    userEmail: row.user_email,
    userPhone: row.user_phone,
    requestId: row.request_id,
    question: row.question,
    answer: row.answer,
    references: tryParseJson(row.references_json),
    citations: tryParseJson(row.citations_json),
    message: row.message,
    moderatorComment: row.moderator_comment,
    reviewedAt: row.reviewed_at,
    createdAt: row.created_at,
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
