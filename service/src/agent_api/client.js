import { log, summarize } from "../utils/log.js";

export class ExternalApiClient {
  constructor({ baseUrl, timeoutMs }) {
    this.baseUrl = baseUrl.replace(/\/$/, "");
    this.timeoutMs = timeoutMs;
  }

  async search(payload, questionId) {
    return this.#post("/api/agent/search", payload, questionId);
  }

  async navigate(payload, questionId) {
    return this.#post("/api/agent/navigate", payload, questionId);
  }

  async findSimilar(payload, questionId) {
    return this.#post("/api/agent/find_similar", payload, questionId);
  }

  async getFilterOptions(payload, questionId) {
    return this.#post("/api/agent/get_filter_options", payload, questionId);
  }

  async getMetadataOptions(payload, questionId) {
    return this.#post("/api/agent/get_metadata_options", payload, questionId);
  }

  async getPravachan(payload, questionId) {
    return this.#post("/api/agent/get_pravachan", payload, questionId);
  }

  async #post(path, payload, questionId) {
    const url = `${this.baseUrl}${path}`;
    const normalizedPayload = normalizeLanguage(payload);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const startedAt = Date.now();
      log.info("external_api_request", { questionId, path, payload: normalizedPayload });
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(normalizedPayload),
        signal: controller.signal,
      });
      const text = await res.text();
      if (!res.ok) {
        log.warn("external_api_failed", {
          questionId,
          path,
          status: res.status,
          body: text.slice(0, 800),
        });
        throw new Error(`External API ${path} failed (${res.status})`);
      }
      if (!text) return [];
      try {
        const parsed = JSON.parse(text);
        log.info("external_api_response", {
          questionId,
          path,
          status: res.status,
          durationMs: Date.now() - startedAt,
          items: Array.isArray(parsed) ? parsed.length : undefined,
        });
        return parsed;
      } catch (err) {
        log.warn("external_api_parse_failed", { questionId, path, body: text.slice(0, 800) });
        throw err;
      }
    } finally {
      clearTimeout(timeout);
    }
  }
}

function normalizeLanguage(payload) {
  if (!payload || typeof payload !== "object") return payload;
  const lang = String(payload.language || "").toLowerCase();
  if (lang === "hi" || lang === "gu") return payload;
  return { ...payload, language: "hi" };
}
