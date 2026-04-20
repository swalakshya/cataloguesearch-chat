import { GoogleGenAI } from "@google/genai";
import { LLMProvider } from "./base.js";
import { log } from "../utils/log.js";

export class GeminiProvider extends LLMProvider {
  constructor({ apiKey, model, timeoutMs, jsonMode, responseMimeType, keyManager, clientFactory }) {
    super();
    this.apiKey = apiKey;
    this.model = model;
    this.timeoutMs = timeoutMs;
    this.jsonMode = jsonMode;
    this.responseMimeType = responseMimeType;
    this.keyManager = keyManager || null;
    this.clientFactory = clientFactory || (({ apiKey }) => new GoogleGenAI({ apiKey }));
  }

  name() {
    return "gemini";
  }

  async completeText({ messages, temperature, maxTokens, requestId }) {
    return this.#generate({ messages, temperature, maxTokens, requestId, jsonMode: false });
  }

  async completeJson({ messages, temperature, maxTokens, requestId, responseJsonSchema }) {
    return this.#generate({
      messages,
      temperature,
      maxTokens,
      requestId,
      jsonMode: true,
      responseJsonSchema,
    });
  }

  async #generate({ messages, temperature, maxTokens, requestId, jsonMode, responseJsonSchema }) {
    const { contents, systemInstruction } = normalizeMessages(messages);
    const config = {};
    if (typeof temperature === "number") config.temperature = temperature;
    if (typeof maxTokens === "number") config.maxOutputTokens = maxTokens;
    if (jsonMode && this.jsonMode) {
      config.responseMimeType = this.responseMimeType || "application/json";
      if (responseJsonSchema) {
        config.responseJsonSchema = responseJsonSchema;
      }
    }
    if (systemInstruction) {
      config.systemInstruction = systemInstruction;
    }

    log.debug("gemini_request", {
      requestId,
      model: this.model,
      temperature,
      maxTokens,
      responseMimeType: config.responseMimeType || null,
    });

    const runOnce = async (apiKey) => {
      if (!apiKey) {
        const err = new Error("GEMINI_API_KEY is required");
        err.status = 401;
        err.provider = "gemini";
        throw err;
      }
      const client = this.clientFactory({ apiKey });
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
      try {
        const response = await client.models.generateContent({
          model: this.model,
          contents,
          config: { ...config, signal: controller.signal },
        });
        const text = response?.text;
        if (!text) {
          throw new Error("Gemini response missing text");
        }
        return String(text).trim();
      } finally {
        clearTimeout(timeout);
      }
    };

    const primaryKey = this.keyManager ? this.keyManager.getKey() : this.apiKey;

    try {
      return await runOnce(primaryKey);
    } catch (err) {
      const message = err?.message || String(err);
      log.warn("gemini_request_failed", { requestId, message });
      if (err && !err.provider) err.provider = "gemini";
      if (this.keyManager && isAuthError(err)) {
        await this.keyManager.refresh();
        return await runOnce(this.keyManager.getKey());
      }
      throw err;
    }
  }

  static fromEnv({ keyManager, modelOverride, apiKeyOverride } = {}) {
    const apiKey =
      apiKeyOverride || process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || process.env.LLM_API_KEY || "";
    const model = modelOverride || "gemini-2.5-flash";
    const timeoutMs = Number(process.env.LLM_REQUEST_TIMEOUT_SEC || 120) * 1000;
    const jsonMode = (process.env.LLM_JSON_MODE || "true").toLowerCase() !== "false";
    const responseMimeType = process.env.GEMINI_RESPONSE_MIME_TYPE || "";
    const keySource = apiKey ? "env" : "secret_manager";

    log.info("gemini_provider_init", {
      model,
      timeoutMs,
      jsonMode,
      responseMimeType: responseMimeType || null,
      keySource,
    });

    return new GeminiProvider({
      apiKey,
      model,
      timeoutMs,
      jsonMode,
      responseMimeType,
      keyManager: apiKey ? null : keyManager,
    });
  }
}

function isAuthError(err) {
  const status = err?.status ?? err?.code ?? err?.response?.status;
  if (status === 401) return true;
  const message = String(err?.message || "").toLowerCase();
  return message.includes("401") || message.includes("unauthorized");
}

function normalizeMessages(messages) {
  const contents = [];
  let systemInstruction = "";
  if (!Array.isArray(messages)) {
    return { contents, systemInstruction };
  }

  for (const message of messages) {
    if (!message || !message.content) continue;
    const role = message.role || "user";
    if (role === "system" && !systemInstruction) {
      systemInstruction = message.content;
      continue;
    }
    const mappedRole = role === "assistant" ? "model" : "user";
    contents.push({ role: mappedRole, parts: [{ text: String(message.content) }] });
  }

  if (!contents.length && systemInstruction) {
    contents.push({ role: "user", parts: [{ text: "" }] });
  }

  return { contents, systemInstruction };
}
