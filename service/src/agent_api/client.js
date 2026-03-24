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

  async getPravachan(payload, requestId) {
    return this.#post("/api/agent/get_pravachan", payload, requestId);
  }

  async #post(path, payload, requestId) {
    const url = `${this.baseUrl}${path}`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const startedAt = Date.now();
      log.info("external_api_request", { requestId, path, payload });
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
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
