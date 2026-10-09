import { AsyncLocalStorage } from 'node:async_hooks';
import { performance } from 'node:perf_hooks';
export const timingContext = new AsyncLocalStorage();
export class OperationTimings {
  constructor(clock = () => performance.now()) {
    this.clock = clock;
    this.started = clock();
    this.at = this.started;
    this.current = null;
    this.operations = {};
    this.searchWork = {};
  }
  stage(stage) {
    if (stage === this.current) return;
    const now = this.clock();
    if (this.current) this.operations[this.current] = (this.operations[this.current] || 0) + now - this.at;
    this.current = stage;
    this.at = now;
  }
  search(timings) {
    for (const key of ['embedding', 'retrieval', 'context', 'reranking']) {
      const value = timings?.operations?.[key];
      if (Number.isFinite(value) && value >= 0) this.searchWork[key] = (this.searchWork[key] || 0) + value;
    }
  }
  finish() {
    const now = this.clock();
    const operations = { ...this.operations };
    if (this.current) operations[this.current] = (operations[this.current] || 0) + now - this.at;
    const round = object => Object.fromEntries(Object.entries(object).map(([key, value]) => [key, Math.round(value)]));
    return { total_ms: Math.round(now - this.started), operations: round(operations), search_work: round(this.searchWork) };
  }
}
