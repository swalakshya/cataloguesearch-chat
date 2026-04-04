import { log } from "../utils/log.js";

export class GeminiKeyManager {
  constructor({ fetcher, key }) {
    this.fetcher = fetcher;
    this.key = key;
  }

  static async create({ fetcher }) {
    const key = await fetcher();
    if (!key) throw new Error("Gemini API key missing from Secret Manager");
    log.info("gemini_key_loaded", { source: "secret_manager" });
    return new GeminiKeyManager({ fetcher, key });
  }

  getKey() {
    return this.key;
  }

  async refresh() {
    const key = await this.fetcher();
    if (!key) throw new Error("Gemini API key missing from Secret Manager");
    this.key = key;
    log.info("gemini_key_refreshed", { source: "secret_manager" });
    return this.key;
  }
}
