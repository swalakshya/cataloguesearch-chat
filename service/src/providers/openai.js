import { LLMProvider } from "./base.js";
import { log, summarize } from "../utils/log.js";

export class OpenAIProvider extends LLMProvider {
  constructor({ apiKey, model, baseUrl, timeoutMs, jsonMode }) {
    super();
    this.apiKey = apiKey;
    this.model = model;
    this.baseUrl = baseUrl || "https://api.openai.com/v1";
    this.timeoutMs = timeoutMs;
    this.jsonMode = jsonMode;
  }

  name() {
    return "openai";
  }

  async completeText({ messages, temperature, maxTokens, requestId }) {
    return this.#chatCompletion({
      messages,
      temperature,
      maxTokens,
      requestId,
      responseFormat: null,
    });
  }

  async completeJson({ messages, temperature, maxTokens, requestId }) {
    const responseFormat = this.jsonMode ? { type: "json_object" } : null;
    return this.#chatCompletion({
      messages,
      temperature,
      maxTokens,
      requestId,
      responseFormat,
    });
  }

  async #chatCompletion({ messages, temperature, maxTokens, requestId, responseFormat }) {
    if (!this.apiKey) {
      const err = new Error("OPENAI_API_KEY is required");
      err.status = 401;
      err.provider = "openai";
      throw err;
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    const payload = {
      model: this.model,
      messages,
      temperature,
    };
    if (typeof maxTokens === "number") payload.max_tokens = maxTokens;
    if (responseFormat) payload.response_format = responseFormat;

    const url = `${this.baseUrl}/chat/completions`;
    log.debug("openai_request", {
      requestId,
      url,
      model: this.model,
      temperature,
      maxTokens,
    });

    try {
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });

      const text = await res.text();
      if (!res.ok) {
        log.warn("openai_request_failed", {
          requestId,
          status: res.status,
          body: text.slice(0, 800),
        });
        const err = new Error(`OpenAI request failed (${res.status})`);
        err.status = res.status;
        err.provider = "openai";
        throw err;
      }

      let json;
      try {
        json = JSON.parse(text);
      } catch (err) {
        log.warn("openai_response_parse_failed", { requestId, body: text.slice(0, 800) });
        throw err;
      }

      const content = json?.choices?.[0]?.message?.content;
      if (!content) {
        log.warn("openai_empty_response", { requestId, response: summarize(json) });
        throw new Error("OpenAI response missing content");
      }
      return content.trim();
    } finally {
      clearTimeout(timeout);
    }
  }

  static fromEnv({ modelOverride, apiKeyOverride } = {}) {
    const apiKey = apiKeyOverride || process.env.OPENAI_API_KEY || process.env.LLM_API_KEY || "";
    const model = modelOverride || "gpt-4o";
    const baseUrl = process.env.OPENAI_BASE_URL || process.env.LLM_BASE_URL || "";
    const timeoutMs = Number(process.env.LLM_REQUEST_TIMEOUT_SEC || 120) * 1000;
    const jsonMode = (process.env.LLM_JSON_MODE || "true").toLowerCase() !== "false";

    log.info("openai_provider_init", {
      model,
      baseUrl: baseUrl || "https://api.openai.com/v1",
      timeoutMs,
      jsonMode,
    });

    return new OpenAIProvider({ apiKey, model, baseUrl, timeoutMs, jsonMode });
  }
}
