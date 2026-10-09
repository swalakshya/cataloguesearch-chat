import { timingContext } from "../utils/operation_timings.js";
import { log, summarize } from "../utils/log.js";

export class ExternalApiClient {
  constructor({ baseUrl, timeoutMs }) {
    this.baseUrl = baseUrl.replace(/\/$/, "");
    this.timeoutMs = timeoutMs;
  }

  async search(payload, requestId) {
    return this.#post("/api/agent/search", payload, requestId);
  }

  async navigate(payload, requestId) {
    return this.#post("/api/agent/navigate", payload, requestId);
  }

  async findSimilar(payload, requestId) {
    return this.#post("/api/agent/find_similar", payload, requestId);
  }

  async getFilterOptions(payload, requestId) {
    return this.#post("/api/agent/get_filter_options", payload, requestId);
  }

  async getMetadataOptions(payload, requestId) {
    return this.#post("/api/agent/get_metadata_options", payload, requestId);
  }

  async getPravachan(payload, requestId) {
    return this.#post("/api/agent/get_pravachan", payload, requestId);
  }

  async #post(path, payload, requestId) {
    const url = `${this.baseUrl}${path}`;
    const normalizedPayload = normalizeLanguage(payload);
    const controller = new AbortController();
    // Accuracy reranking can use 60 seconds plus embedding/retrieval time.
    const timeoutMs = path === "/api/agent/search" && normalizedPayload?.accuracy_mode === true
      ? Math.max(this.timeoutMs, 90_000) : this.timeoutMs;
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const startedAt = Date.now();
      log.verbose("external_api_request", { requestId, path, payload: normalizedPayload });
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(requestId ? { "X-Chat-Request-Id": requestId } : {}),
        },
        body: JSON.stringify(normalizedPayload),
        signal: controller.signal,
      });
      const text = await res.text();
      if (!res.ok) {
        log.warn("external_api_failed", {
          requestId,
          path,
          status: res.status,
          body: text.slice(0, 800),
        });
        throw new Error(`External API ${path} failed (${res.status})`);
      }
      if (!text) return [];
      try {
        const parsed = JSON.parse(text);
        if (path === "/api/agent/search") {
          try { timingContext.getStore()?.search(JSON.parse(res.headers.get("X-Search-Timings") || "null")); }
          catch { /* Timing metadata is optional and must not fail a search. */ }
        }
        log.info("external_api_response", {
          requestId,
          path,
          status: res.status,
          durationMs: Date.now() - startedAt,
          items: Array.isArray(parsed) ? parsed.length : undefined,
        });
        return parsed;
      } catch (err) {
        log.warn("external_api_parse_failed", { requestId, path, body: text.slice(0, 800) });
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
