import crypto from "node:crypto";

import { log } from "../utils/log.js";
import { sendNotHelpfulEmail } from "./feedback_mailer.js";

const VALID_VOTES = new Set(["helpful", "not_helpful"]);
const VALID_STATUSES = new Set(["new", "archived"]);

export function registerFeedbackRoutes(app, feedbackStore, { adminApiKey } = {}) {
  // POST /v1/feedback — submit feedback
  app.post("/v1/feedback", (req, res) => {
    log.info("feedback_request", {
      vote: req.body?.vote ?? null,
      requestId: req.body?.request_id ?? null,
      hasQuestion: Boolean(req.body?.question),
      hasAnswer: Boolean(req.body?.answer),
      hasMessage: Boolean(req.body?.message),
      userName: req.body?.user_name ?? null,
    });

    if (!feedbackStore) {
      return res.status(503).json({ detail: "feedback_not_enabled" });
    }

    const {
      vote,
      request_id,
      question,
      answer,
      references,
      citations,
      user_name,
      user_email,
      user_phone,
      message,
    } = req.body || {};

    // Validate vote
    if (!vote || !VALID_VOTES.has(vote)) {
      return res.status(400).json({ detail: "vote_required", allowed: ["helpful", "not_helpful"] });
    }

    // Validate snapshots
    if (!question || typeof question !== "string" || !question.trim()) {
      return res.status(400).json({ detail: "question_required" });
    }
    if (!answer || typeof answer !== "string" || !answer.trim()) {
      return res.status(400).json({ detail: "answer_required" });
    }

    // not_helpful requires message and user identity
    if (vote === "not_helpful") {
      if (!message || typeof message !== "string" || !message.trim()) {
        return res.status(400).json({ detail: "message_required_for_not_helpful" });
      }
      if (!user_name || typeof user_name !== "string" || !user_name.trim()) {
        return res.status(400).json({ detail: "user_name_required" });
      }
      if (
        (!user_email || typeof user_email !== "string" || !user_email.trim()) &&
        (!user_phone || typeof user_phone !== "string" || !user_phone.trim())
      ) {
        return res.status(400).json({ detail: "user_email_or_phone_required" });
      }
    }

    const answerKey = computeAnswerKey(question, answer);

    // Dedup: one submission per answer per request_id
    if (request_id && feedbackStore.isDuplicate(answerKey, request_id)) {
      return res.status(409).json({ detail: "feedback_already_submitted" });
    }

    const record = {
      id: crypto.randomUUID(),
      answerKey,
      vote,
      requestId: request_id ? String(request_id).trim() : null,
      question: question.trim(),
      answer: answer.trim(),
      references: Array.isArray(references) ? references : null,
      citations: Array.isArray(citations) ? citations : null,
      userName: user_name ? String(user_name).trim() : null,
      userEmail: user_email ? String(user_email).trim() : null,
      userPhone: user_phone ? String(user_phone).trim() : null,
      message: message ? String(message).trim() : null,
      createdAt: Date.now(),
    };

    try {
      feedbackStore.insert(record);
      if (record.vote === "not_helpful") {
        sendNotHelpfulEmail(record).catch(() => null);
      }
      log.info("feedback_response", { id: record.id, vote: record.vote, status: 201 });
      return res.status(201).json({ id: record.id });
    } catch (err) {
      log.error("feedback_insert_failed", { message: err?.message || String(err) });
      return res.status(500).json({ detail: "feedback_store_failed" });
    }
  });

  // Admin routes — require x-admin-key header
  app.get("/v1/admin/feedback", requireAdmin(adminApiKey), (req, res) => {
    if (!feedbackStore) {
      return res.status(503).json({ detail: "feedback_not_enabled" });
    }

    const status = VALID_STATUSES.has(req.query.status) ? req.query.status : null;
    const limit = Math.min(Number(req.query.limit) || 50, 200);
    const offset = Math.max(Number(req.query.offset) || 0, 0);

    const { rows, total } = feedbackStore.list({ status, limit, offset });
    return res.json({ feedback: rows, total, limit, offset });
  });

  app.get("/v1/admin/feedback/:id", requireAdmin(adminApiKey), (req, res) => {
    if (!feedbackStore) {
      return res.status(503).json({ detail: "feedback_not_enabled" });
    }

    const record = feedbackStore.getById(req.params.id);
    if (!record) {
      return res.status(404).json({ detail: "feedback_not_found" });
    }
    return res.json(record);
  });

  app.patch("/v1/admin/feedback/:id", requireAdmin(adminApiKey), (req, res) => {
    if (!feedbackStore) {
      return res.status(503).json({ detail: "feedback_not_enabled" });
    }

    const { status, moderator_comment } = req.body || {};

    if (!status || !VALID_STATUSES.has(status)) {
      return res.status(400).json({ detail: "status_required", allowed: ["new", "archived"] });
    }

    const existing = feedbackStore.getById(req.params.id);
    if (!existing) {
      return res.status(404).json({ detail: "feedback_not_found" });
    }

    feedbackStore.patch(req.params.id, {
      status,
      moderatorComment: moderator_comment ? String(moderator_comment).trim() : null,
    });

    return res.json({ id: req.params.id, status });
  });
}

function requireAdmin(adminApiKey) {
  return (req, res, next) => {
    if (!adminApiKey) {
      return res.status(503).json({ detail: "admin_not_configured" });
    }
    const key = req.headers["x-admin-key"];
    if (!key || key !== adminApiKey) {
      return res.status(401).json({ detail: "unauthorized" });
    }
    next();
  };
}

function computeAnswerKey(question, answer) {
  return crypto
    .createHash("sha256")
    .update(question.trim() + "\x00" + answer.trim())
    .digest("hex")
    .slice(0, 32);
}
