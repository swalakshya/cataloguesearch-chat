import fs from "node:fs";
import path from "node:path";

import Database from "better-sqlite3";

import { log } from "../utils/log.js";

const SESSION_SCHEMA_VERSION = 1;
const TITLE_MAX_LENGTH = 120;

export class SessionStore {
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

    // `title` was added after the table already shipped -- back-fill it on
    // any DB file created before this column existed, rather than relying on
    // CREATE TABLE IF NOT EXISTS (which is a no-op against an existing table).
    const existingColumns = this.db.prepare("PRAGMA table_info(sessions)").all().map((c) => c.name);
    if (!existingColumns.includes("title")) {
      this.db.exec("ALTER TABLE sessions ADD COLUMN title TEXT");
    }
    // `claimed` marks a session as owned by a real authenticated account
    // (set at creation when the request carried a valid login cookie, or by
    // reassignUser on merge) -- as opposed to a userId that's just an
    // anonymous browser-generated id. This is what lets forbidsAccess (see
    // server.js) tell "anonymous session, permissively accessible" apart
    // from "a real account's session, an unauthenticated caller must not
    // read this just by omitting their cookie". Also restricts reassignUser
    // to genuinely-unclaimed sessions, so merge can't be used to steal
    // another real account's already-claimed history.
    if (!existingColumns.includes("claimed")) {
      this.db.exec("ALTER TABLE sessions ADD COLUMN claimed INTEGER NOT NULL DEFAULT 0");
    }

    // One-time backfill: any row saved before per-message title derivation
    // existed (or reassigned by an older reassignUser that didn't set title)
    // has title = NULL forever otherwise -- listByUser still returns it, and
    // the frontend's `session.title || 'New conversation'` fallback then
    // shows every single one of these as an indistinguishable "New
    // conversation", even though `data` still has the real messages to
    // derive a title from. Runs once per process start; once backfilled
    // there are no more NULL-title rows, so later restarts are a fast no-op.
    const rowsMissingTitle = this.db.prepare("SELECT session_id, data FROM sessions WHERE title IS NULL").all();
    if (rowsMissingTitle.length > 0) {
      const backfillTitleStmt = this.db.prepare("UPDATE sessions SET title = ? WHERE session_id = ?");
      const backfillTitles = this.db.transaction((rows) => {
        for (const row of rows) {
          let data;
          try {
            data = JSON.parse(row.data);
          } catch {
            continue; // corrupt row -- skip rather than fail startup
          }
          const title = deriveTitle(data?.messages);
          if (title) backfillTitleStmt.run(title, row.session_id);
        }
      });
      backfillTitles(rowsMissingTitle);
      log.info("session_title_backfill", { rowsScanned: rowsMissingTitle.length });
    }

    this.upsertStmt = this.db.prepare(`
      INSERT INTO sessions (
        session_id,
        user_id,
        language,
        message_count,
        created_at,
        last_activity_at,
        title,
        claimed,
        data
      ) VALUES (
        @session_id,
        @user_id,
        @language,
        @message_count,
        @created_at,
        @last_activity_at,
        @title,
        @claimed,
        @data
      )
      ON CONFLICT(session_id) DO UPDATE SET
        user_id = excluded.user_id,
        language = excluded.language,
        message_count = excluded.message_count,
        created_at = excluded.created_at,
        last_activity_at = excluded.last_activity_at,
        title = excluded.title,
        claimed = excluded.claimed,
        data = excluded.data
    `);
    this.restoreStmt = this.db.prepare(`
      SELECT session_id, user_id, message_count, created_at, last_activity_at, claimed, data
      FROM sessions
      WHERE session_id = ?
    `);
    // claimed = 1 only: an unclaimed session under this user_id was never
    // tied to a real login here (see POST /v1/chat/sessions) -- it can only
    // be a coincidence or a "planted" session from a caller who guessed/knew
    // this id, and must never be conflated with the account's real history.
    this.listByUserStmt = this.db.prepare(`
      SELECT session_id, language, message_count, last_activity_at, title
      FROM sessions
      WHERE user_id = ? AND claimed = 1
      ORDER BY last_activity_at DESC
    `);
    this.deleteStmt = this.db.prepare(`
      DELETE FROM sessions
      WHERE session_id = ?
    `);
    this.clearStmt = this.db.prepare(`
      DELETE FROM sessions
    `);
    this.selectUnclaimedByUserStmt = this.db.prepare(`
      SELECT session_id, title, data FROM sessions WHERE user_id = ? AND claimed = 0
    `);
    this.reassignRowStmt = this.db.prepare(`
      UPDATE sessions SET user_id = ?, claimed = 1, title = ?, data = ? WHERE session_id = ?
    `);
  }

  upsert(session) {
    if (!session?.sessionId) return;
    const record = toPersistedRecord(session);
    // The title is fixed by the first user message and never changes again,
    // so cache it on the live session object instead of re-scanning
    // session.messages on every single turn for the rest of the
    // conversation's life. Only cache once it's actually non-null -- the
    // very first upsert (session just created, no user message yet) must
    // keep recomputing until there's a real title to lock in.
    if (!session._cachedTitle) {
      session._cachedTitle = deriveTitle(record.messages);
    }
    this.upsertStmt.run({
      session_id: session.sessionId,
      user_id: record.userId,
      language: record.language || "hi",
      message_count: Array.isArray(record.messages) ? record.messages.length : 0,
      created_at: Number(record.createdAt) || Date.now(),
      last_activity_at: Number(record.lastActivityAt) || Date.now(),
      title: session._cachedTitle,
      claimed: record.claimed ? 1 : 0,
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
      title: row.title ?? null,
    }));
  }

  // Reassigns every UNCLAIMED session owned by fromUserId (typically the
  // browser's anonymous id) to toUserId (a freshly logged-in account) --
  // called once, right after first login. Only touches claimed=0 rows, so
  // this can never be used to steal another real account's already-claimed
  // history even if fromUserId happens to collide with one. Updates both the
  // user_id/claimed columns AND the embedded data JSON in the same
  // transaction -- restore()'s fromPersistedRecord prefers data.userId over
  // the row's own user_id column, so a column-only update would silently
  // revert on the next eviction+restore. Returns how many rows moved.
  reassignUser(fromUserId, toUserId) {
    if (!fromUserId || !toUserId) return 0;
    const rows = this.selectUnclaimedByUserStmt.all(fromUserId);
    if (rows.length === 0) return 0;

    const reassign = this.db.transaction((toMove) => {
      let moved = 0;
      for (const row of toMove) {
        let data;
        try {
          data = JSON.parse(row.data);
        } catch {
          continue; // corrupt row -- skip rather than fail the whole merge
        }
        data.userId = toUserId;
        data.claimed = true;
        const title = row.title ?? deriveTitle(data.messages);
        this.reassignRowStmt.run(toUserId, title, JSON.stringify(data), row.session_id);
        moved += 1;
      }
      return moved;
    });

    return reassign(rows);
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
    claimed: Boolean(session.claimed),
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
    claimed: Boolean(data?.claimed ?? row.claimed),
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

function deriveTitle(messages) {
  if (!Array.isArray(messages)) return null;
  const firstUserMessage = messages.find(
    (m) => m?.role === "user" && typeof m.content === "string" && m.content.trim()
  );
  if (!firstUserMessage) return null;
  const content = firstUserMessage.content.trim();
  if (content.length <= TITLE_MAX_LENGTH) return content;
  return `${content.slice(0, TITLE_MAX_LENGTH)}…`;
}
