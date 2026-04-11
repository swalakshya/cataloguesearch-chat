export class ModelAvailabilityTracker {
  constructor({ windowMs, failureRateThreshold, minSamples, now }) {
    this.windowMs = windowMs;
    this.failureRateThreshold = failureRateThreshold;
    this.minSamples = minSamples;
    this.now = now || (() => Date.now());
    this.events = new Map();
    this.hardDisabledUntil = new Map();
  }

  record(modelId, isFailure) {
    if (!this.events.has(modelId)) this.events.set(modelId, []);
    const list = this.events.get(modelId);
    list.push({ ts: this.now(), isFailure: Boolean(isFailure) });
  }

  isAvailable(modelId) {
    const hardUntil = this.hardDisabledUntil.get(modelId);
    if (hardUntil && this.now() < hardUntil) return false;
    const list = this.events.get(modelId) || [];
    const cutoff = this.now() - this.windowMs;
    while (list.length && list[0].ts < cutoff) {
      list.shift();
    }
    const total = list.length;
    if (total < this.minSamples) return true;
    const failures = list.reduce((acc, e) => acc + (e.isFailure ? 1 : 0), 0);
    return failures / total <= this.failureRateThreshold;
  }

  getStats(modelId) {
    const list = this.events.get(modelId) || [];
    const total = list.length;
    const failures = list.reduce((acc, e) => acc + (e.isFailure ? 1 : 0), 0);
    return { total, failures, failureRate: total ? failures / total : 0 };
  }

  reset() {
    this.events.clear();
    this.hardDisabledUntil.clear();
  }

  hardDisable(modelId) {
    this.hardDisabledUntil.set(modelId, this.now() + this.windowMs);
  }
}
