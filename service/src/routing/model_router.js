import { classifyProviderError } from "./error_classifier.js";

export class ModelRouter {
  constructor({ models, tracker, logger }) {
    this.models = models;
    this.tracker = tracker;
    this.logger = logger;
  }

  getAvailableModels() {
    return this.models.filter((m) => this.tracker.isAvailable(m.id));
  }

  async route(attemptFn) {
    const candidates = this.getAvailableModels();
    if (!candidates.length) {
      const err = new Error("service_unavailable");
      err.status = 503;
      err.code = "service_unavailable";
      throw err;
    }

    let lastErr = null;
    for (const model of candidates) {
      try {
        const result = await attemptFn(model);
        this.tracker.record(model.id, false);
        return result;
      } catch (err) {
        lastErr = err;
        const classification = classifyProviderError(err);
        if (classification.kind === "server") {
          if (Number(err?.status) === 429) {
            this.tracker.hardDisable(model.id);
          }
          this.tracker.record(model.id, true);
          continue;
        }
        throw err;
      }
    }

    throw lastErr || new Error("provider_unavailable");
  }
}
