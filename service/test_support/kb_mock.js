import express from "express";
import { createServer as createHttpServer } from "node:http";

/**
 * In-process Express mock for the kb-service.
 * Mimics the endpoints used by KbApiClient. Supports:
 *   - Configurable per-endpoint behaviors (status, body, delay)
 *   - Per-endpoint call tracking (count, last query/body)
 *   - Reset via reset()
 *
 * Usage:
 *   const kbMock = createKbMock();
 *   const kbBaseUrl = await kbMock.start();
 *   kbMock.setBehavior("topics_match", { body: { matches: [...], tool_trace_id: "x" } });
 *   // ... run tests ...
 *   kbMock.reset();
 *   await kbMock.stop();
 */
export function createKbMock() {
  const app = express();
  app.use(express.json());

  let behaviors = {};
  const callLog = []; // { endpoint, method, query, body, timestamp }

  function respond(endpoint, method, req, res) {
    callLog.push({ endpoint, method, query: { ...req.query }, body: req.body || null, timestamp: Date.now() });

    const behavior = behaviors[endpoint];
    if (behavior?.status && behavior.status >= 400) {
      return res.status(behavior.status).json({ error: behavior.message || "mock_error" });
    }
    const send = () => res.status(behavior?.status || 200).json(behavior?.body ?? []);
    if (behavior?.delay && behavior.delay > 0) {
      setTimeout(send, behavior.delay);
    } else {
      send();
    }
  }

  // ── kb endpoints (paths/methods mirror src/kb_api/client.js exactly) ──────────
  // core-service (metadata) endpoints — GET on coreBaseUrl
  app.get("/v1/shastras",                     (req, res) => respond("shastras",               "GET",  req, res));
  app.get("/v1/authors",                      (req, res) => respond("authors",                "GET",  req, res));
  app.get("/v1/teekas",                       (req, res) => respond("teekas",                 "GET",  req, res));
  app.get("/v1/gathas",                       (req, res) => respond("gathas",                 "GET",  req, res));
  // query-service endpoints — POST on baseUrl
  app.post("/v1/query/topics_in_shastra",     (req, res) => respond("topics_in_shastra",      "POST", req, res));
  app.post("/v1/query/shastras_for_topic",    (req, res) => respond("shastras_for_topic",     "POST", req, res));
  app.post("/v1/query/keyword_resolve_batch", (req, res) => respond("keyword_resolve_batch",  "POST", req, res));
  app.post("/v1/query/topics_match",          (req, res) => respond("topics_match",           "POST", req, res));
  app.post("/v1/query/topic_neighbors",       (req, res) => respond("topic_neighbors",        "POST", req, res));
  app.post("/v1/query/graphrag",              (req, res) => respond("graphrag",               "POST", req, res));

  // ── lifecycle ───────────────────────────────────────────────────────────────
  let httpServer = null;
  let _baseUrl = "";

  return {
    get baseUrl() { return _baseUrl; },

    callCountFor(endpoint) {
      return callLog.filter((c) => c.endpoint === endpoint).length;
    },

    totalCallCount() {
      return callLog.length;
    },

    callsFor(endpoint) {
      return callLog.filter((c) => c.endpoint === endpoint).slice();
    },

    allCalls() {
      return callLog.slice();
    },

    /** Set behavior for a specific endpoint key. */
    setBehavior(endpoint, behavior) {
      behaviors[endpoint] = behavior;
    },

    /** Set all endpoints to return an error status. */
    setAllError(status = 500) {
      for (const ep of ALL_ENDPOINTS) {
        behaviors[ep] = { status };
      }
    },

    /** Clear call log and behaviors. */
    reset() {
      callLog.length = 0;
      behaviors = {};
    },

    async start() {
      await new Promise((resolve, reject) => {
        httpServer = createHttpServer(app);
        httpServer.listen(0, "127.0.0.1", () => {
          const addr = httpServer.address();
          _baseUrl = `http://127.0.0.1:${addr.port}`;
          resolve();
        });
        httpServer.once("error", reject);
      });
      return _baseUrl;
    },

    async stop() {
      if (!httpServer) return;
      await new Promise((resolve) => httpServer.close(() => resolve()));
      httpServer = null;
      _baseUrl = "";
    },
  };
}

const ALL_ENDPOINTS = [
  "shastras", "authors", "teekas", "gathas",
  "topics_in_shastra", "shastras_for_topic",
  "keyword_resolve_batch", "topics_match", "topic_neighbors", "graphrag",
];
