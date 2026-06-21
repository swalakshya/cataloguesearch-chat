import { log } from "../utils/log.js";

/**
 * Pick the Hindi (or first available) text from a core-service localized-string
 * array such as `title` / `display_name` (`[{lang, script, text}, ...]`).
 */
function pickLocalizedText(field) {
  if (!Array.isArray(field) || field.length === 0) return "";
  const hi = field.find((f) => f && (f.lang === "hin" || f.lang === "hi"));
  return (hi || field[0])?.text || "";
}

/**
 * Normalize a core-service resource list response (`{ items, pagination }`)
 * into a flat array of `{ natural_key, name, similarity, ...raw }`. Tolerates a
 * bare-array response (e.g. test mocks) by passing it through unchanged.
 * `nameField` is the localized-string property holding the display name.
 */
function normalizeResourceItems(parsed, nameField) {
  const items = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.items) ? parsed.items : [];
  return items.map((item) => {
    if (!item || typeof item !== "object") return item;
    // Already normalized (test mocks supplying `name` directly) — keep as is.
    const name = item.name != null ? item.name : pickLocalizedText(item[nameField]);
    return { ...item, name };
  });
}

export class KbApiClient {
  constructor({ baseUrl, coreBaseUrl, timeoutMs, onCallComplete } = {}) {
    this.baseUrl = (baseUrl || "").replace(/\/$/, "");
    // coreBaseUrl points to the merged core-service (metadata + data + navigation domains).
    // Falls back to baseUrl when not supplied (e.g. in tests that don't set it).
    this.coreBaseUrl = (coreBaseUrl || baseUrl || "").replace(/\/$/, "");
    this.timeoutMs = timeoutMs;
    this._onCallComplete = typeof onCallComplete === "function" ? onCallComplete : null;
  }

  async shastras({ q, fuzzy = true, limit = 5 } = {}, requestId) {
    const params = new URLSearchParams({ q: String(q || ""), fuzzy: String(fuzzy), limit: String(limit) });
    const parsed = await this.#get(`/v1/shastras?${params}`, requestId, this.coreBaseUrl);
    return normalizeResourceItems(parsed, "title");
  }

  async authors({ q, fuzzy = true, limit = 5 } = {}, requestId) {
    const params = new URLSearchParams({ q: String(q || ""), fuzzy: String(fuzzy), limit: String(limit) });
    const parsed = await this.#get(`/v1/authors?${params}`, requestId, this.coreBaseUrl);
    return normalizeResourceItems(parsed, "display_name");
  }

  async teekas({ q, fuzzy = true, limit = 5 } = {}, requestId) {
    const params = new URLSearchParams({ q: String(q || ""), fuzzy: String(fuzzy), limit: String(limit) });
    const parsed = await this.#get(`/v1/teekas?${params}`, requestId, this.coreBaseUrl);
    return normalizeResourceItems(parsed, "title");
  }

  async keywordResolveBatch(tokens, { fuzzyTopK = 5, includeDefinitions = false, definitionsPerKeyword = 0 } = {}, requestId) {
    const parsed = await this.#post(
      "/v1/query/keyword_resolve_batch",
      { tokens, fuzzy_top_k: fuzzyTopK, include_definitions: includeDefinitions, definitions_per_keyword: definitionsPerKeyword },
      requestId
    );
    // Response shape: { resolutions: [...], tool_trace_id }. Unwrap to the array
    // so callers (kb_keyword_check, kb_definitions) receive resolutions directly.
    return Array.isArray(parsed?.resolutions) ? parsed.resolutions : [];
  }

  async gathaDetail({ shastra, number }, requestId) {
    const params = new URLSearchParams({ shastra: String(shastra || ""), number: String(number ?? "") });
    return this.#get(`/v1/gathas?${params}`, requestId, this.coreBaseUrl);
  }

  async topicsInShastra({ shastra, gathaNumber = null, limit = 25 } = {}, requestId) {
    const body = { shastra_natural_key: String(shastra || ""), limit };
    if (gathaNumber != null) body.gatha_number = gathaNumber;
    const parsed = await this.#post("/v1/query/topics_in_shastra", body, requestId);
    return Array.isArray(parsed?.topics) ? parsed.topics : [];
  }

  async shastrasForTopic({ topicNaturalKey, limitShastras = 10, limitGathasPerShastra = 10 } = {}, requestId) {
    const parsed = await this.#post(
      "/v1/query/shastras_for_topic",
      { topic_natural_key: String(topicNaturalKey || ""), limit_shastras: limitShastras, limit_gathas_per_shastra: limitGathasPerShastra },
      requestId
    );
    return Array.isArray(parsed?.shastras) ? parsed.shastras : [];
  }

  async topicsMatch({ keywords, limit = 5, includeExtracts = true, includeReferences = true } = {}, requestId) {
    const parsed = await this.#post(
      "/v1/query/topics_match",
      { keywords, limit, include_extracts: includeExtracts, include_references: includeReferences },
      requestId
    );
    return Array.isArray(parsed?.matches) ? parsed.matches : [];
  }

  async graphrag({ tokens, limit = 5, includeExtracts = true, includeNeighbors = true, includeReferences = true } = {}, requestId) {
    const parsed = await this.#post(
      "/v1/query/graphrag",
      { tokens, limit, include_extracts: includeExtracts, include_neighbors: includeNeighbors, include_references: includeReferences },
      requestId
    );
    return Array.isArray(parsed?.ranked_topics) ? parsed.ranked_topics : [];
  }

  async topicNeighbors({ topicNaturalKeys, maxNeighborsPerTopic = 10, includeExtracts = false, includeReferences = false } = {}, requestId) {
    const parsed = await this.#post(
      "/v1/query/topic_neighbors",
      { topic_natural_keys: topicNaturalKeys, max_neighbors_per_topic: maxNeighborsPerTopic, include_extracts: includeExtracts, include_references: includeReferences },
      requestId
    );
    // The query-service returns `neighbors_by_anchor` as a LIST of
    // { anchor_topic_natural_key, related_topics, related_keywords, mentioned_in_gathas }.
    // Convert it to a map keyed by anchor natural_key for attachNeighbors().
    // Tolerates the legacy object-map shape as a pass-through.
    const raw = parsed?.neighbors_by_anchor;
    if (Array.isArray(raw)) {
      const map = {};
      for (const entry of raw) {
        const key = entry?.anchor_topic_natural_key;
        if (key) map[key] = entry;
      }
      return map;
    }
    return (raw && typeof raw === "object") ? raw : {};
  }

  async #get(path, requestId, base) {
    const url = `${base ?? this.baseUrl}${path}`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const startedAt = Date.now();
      log.verbose("kb_api_request", { requestId, path });
      const res = await fetch(url, {
        method: "GET",
        headers: {
          ...(requestId ? { "X-Chat-Request-Id": requestId } : {}),
        },
        signal: controller.signal,
      });
      const text = await res.text();
      if (!res.ok) {
        log.warn("kb_api_failed", { requestId, path, status: res.status, body: text.slice(0, 800) });
        this._onCallComplete?.({ endpoint: path, durationMs: Date.now() - startedAt, success: false });
        throw new Error(`KB API ${path} failed (${res.status})`);
      }
      if (!text) {
        this._onCallComplete?.({ endpoint: path, durationMs: Date.now() - startedAt, success: true });
        return [];
      }
      try {
        const parsed = JSON.parse(text);
        const durationMs = Date.now() - startedAt;
        log.info("kb_api_response", {
          requestId,
          path,
          status: res.status,
          durationMs,
          items: Array.isArray(parsed) ? parsed.length : undefined,
        });
        this._onCallComplete?.({ endpoint: path, durationMs, success: true });
        return parsed;
      } catch (err) {
        log.warn("kb_api_parse_failed", { requestId, path, body: text.slice(0, 800) });
        this._onCallComplete?.({ endpoint: path, durationMs: Date.now() - startedAt, success: false });
        throw err;
      }
    } finally {
      clearTimeout(timeout);
    }
  }

  async #post(path, payload, requestId) {
    const url = `${this.baseUrl}${path}`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const startedAt = Date.now();
      log.verbose("kb_api_request", { requestId, path, payload });
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(requestId ? { "X-Chat-Request-Id": requestId } : {}),
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
      const text = await res.text();
      if (!res.ok) {
        log.warn("kb_api_failed", {
          requestId,
          path,
          status: res.status,
          body: text.slice(0, 800),
        });
        this._onCallComplete?.({ endpoint: path, durationMs: Date.now() - startedAt, success: false });
        throw new Error(`KB API ${path} failed (${res.status})`);
      }
      if (!text) {
        this._onCallComplete?.({ endpoint: path, durationMs: Date.now() - startedAt, success: true });
        return [];
      }
      try {
        const parsed = JSON.parse(text);
        const durationMs = Date.now() - startedAt;
        log.info("kb_api_response", {
          requestId,
          path,
          status: res.status,
          durationMs,
          items: Array.isArray(parsed) ? parsed.length : undefined,
        });
        this._onCallComplete?.({ endpoint: path, durationMs, success: true });
        return parsed;
      } catch (err) {
        log.warn("kb_api_parse_failed", { requestId, path, body: text.slice(0, 800) });
        this._onCallComplete?.({ endpoint: path, durationMs: Date.now() - startedAt, success: false });
        throw err;
      }
    } finally {
      clearTimeout(timeout);
    }
  }
}
