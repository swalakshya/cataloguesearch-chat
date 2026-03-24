import { GoogleGenAI } from "@google/genai";
import { LLMProvider } from "./base.js";
import { log, maskKey } from "../utils/log.js";

export class GeminiProvider extends LLMProvider {
  constructor({ apiKey, model, timeoutMs, jsonMode, responseMimeType }) {
    super();
    this.apiKey = apiKey;
    this.model = model;
    this.timeoutMs = timeoutMs;
    this.jsonMode = jsonMode;
    this.responseMimeType = responseMimeType;
    this.client = new GoogleGenAI({ apiKey });
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
    if (!this.apiKey) {
      throw new Error("GEMINI_API_KEY is required");
    }

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

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await this.client.models.generateContent({
        model: this.model,
        contents,
        config,
        signal: controller.signal,
      });

      const text = response?.text;
      if (!text) {
        throw new Error("Gemini response missing text");
      }
      return String(text).trim();
    } catch (err) {
      const message = err?.message || String(err);
      log.warn("gemini_request_failed", { requestId, message });
      throw err;
    } finally {
      clearTimeout(timeout);
    }
  }

  static fromEnv() {
    const apiKey =
      process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || process.env.LLM_API_KEY || "";
    const model = process.env.LLM_MODEL || "gemini-2.0-flash";
    const timeoutMs = Number(process.env.LLM_REQUEST_TIMEOUT_SEC || 120) * 1000;
    const jsonMode = (process.env.LLM_JSON_MODE || "true").toLowerCase() !== "false";
    const responseMimeType = process.env.GEMINI_RESPONSE_MIME_TYPE || "";

    log.info("gemini_provider_init", {
      model,
      timeoutMs,
      apiKey: maskKey(apiKey),
      jsonMode,
      responseMimeType: responseMimeType || null,
    });

    return new GeminiProvider({ apiKey, model, timeoutMs, jsonMode, responseMimeType });
  }
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
