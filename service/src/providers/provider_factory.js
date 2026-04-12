import { OpenAIProvider } from "./openai.js";
import { GeminiProvider } from "./gemini.js";
import { GeminiKeyManager } from "../secrets/gemini_key_manager.js";
import { buildSecretAccessor, logSecretManagerInit } from "../secrets/gcp_secret_manager.js";

export class ProviderFactory {
  constructor({ secretAccessorFactory } = {}) {
    this.secretAccessorFactory =
      secretAccessorFactory ||
      (({ projectId, secretName, secretVersion, keyFilename }) => {
        logSecretManagerInit({ projectId, secretName, secretVersion });
        return buildSecretAccessor({ projectId, secretName, secretVersion, keyFilename });
      });
  }

  async getProvider({ providerId, modelId }) {
    if (providerId === "openai") {
      return this.#buildOpenAI(modelId);
    }
    if (providerId === "gemini") {
      return this.#buildGemini(modelId);
    }
    throw new Error(`Provider not supported: ${providerId}`);
  }

  async #buildOpenAI(modelId) {
    const envKey = process.env.OPENAI_API_KEY || process.env.LLM_API_KEY || "";
    const apiKey = await this.#resolveApiKey(modelId, envKey);
    return OpenAIProvider.fromEnv({ modelOverride: modelId, apiKeyOverride: apiKey });
  }

  async #buildGemini(modelId) {
    const envKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || process.env.LLM_API_KEY || "";
    if (envKey) {
      return GeminiProvider.fromEnv({ modelOverride: modelId, apiKeyOverride: envKey });
    }
    const fetcher = await this.#resolveApiKeyFetcher(modelId);
    if (!fetcher) {
      return GeminiProvider.fromEnv({ modelOverride: modelId, apiKeyOverride: "" });
    }
    const keyManager = await GeminiKeyManager.create({ fetcher });
    return GeminiProvider.fromEnv({ modelOverride: modelId, keyManager });
  }

  async #resolveApiKey(modelId, envKey) {
    if (envKey) return envKey;
    const fetcher = await this.#resolveApiKeyFetcher(modelId);
    if (!fetcher) return "";
    return await fetcher();
  }

  async #resolveApiKeyFetcher(modelId) {
    const projectId = process.env.GCP_PROJECT_ID || "";
    const secretVersion = process.env.GCP_SECRET_VERSION || "latest";
    const keyFilename = process.env.GCP_SA_KEY_PATH || "";
    const safeModelId = String(modelId || "").replace(/\./g, "_");
    const secretName = process.env.GCP_SECRET_NAME_PREFIX
      ? `${process.env.GCP_SECRET_NAME_PREFIX}-${safeModelId}`
      : safeModelId;
    if (!projectId || !secretName || !keyFilename) return null;
    return this.secretAccessorFactory({ projectId, secretName, secretVersion, keyFilename });
  }
}
