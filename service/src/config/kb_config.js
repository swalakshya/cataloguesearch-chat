import { MODEL_ROUTING_CONFIG } from "./model_config.js";

function readBool(name, fallback) {
  const v = process.env[name];
  if (v === undefined || v === null || v === "") return fallback;
  return String(v).toLowerCase() === "true";
}

function readInt(name, fallback) {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

function readFloat(name, fallback) {
  const n = parseFloat(String(process.env[name] ?? ""));
  return Number.isFinite(n) ? n : fallback;
}

// ─── Master flag ───────────────────────────────────────────────────────────────

const masterEnabled = readBool("KB_ENHANCE_ENABLED", false);

// ─── Per-phase flags ───────────────────────────────────────────────────────────
// Each defaults to the master flag when its own env var is absent.

export const KB_PHASE_FLAGS = {
  masterEnabled,
  keywordResolve: readBool("KB_ENHANCE_KEYWORD_RESOLVE", masterEnabled),
  topicMatch:     readBool("KB_ENHANCE_TOPIC_MATCH",     masterEnabled),
  guidedFilters:  readBool("KB_ENHANCE_GUIDED_FILTERS",  masterEnabled),
  metadata:       readBool("KB_ENHANCE_METADATA",        masterEnabled),
  subworkflows:   readBool("KB_ENHANCE_SUBWORKFLOWS",    masterEnabled),
  definitions:    readBool("KB_ENHANCE_DEFINITIONS",     masterEnabled),
};

// ─── Endpoint config ───────────────────────────────────────────────────────────

export const KB_ENDPOINTS = {
  serviceBaseUrl:  String(process.env.KB_SERVICE_BASE_URL      || "http://localhost:8004"),
  coreServiceBaseUrl: String(process.env.KB_CORE_SERVICE_BASE_URL || "http://localhost:8001"),
  requestTimeoutMs:   readInt("KB_REQUEST_TIMEOUT_SEC", 15) * 1000,
  requestMaxRetries:  readInt("KB_REQUEST_MAX_RETRIES", 1),
};

// ─── Caps & limits (env-level defaults) ────────────────────────────────────────

export const KB_CAPS_DEFAULTS = {
  keyword_resolve_max_tokens:   readInt("KB_KEYWORD_RESOLVE_MAX_TOKENS", 32),
  keyword_fuzzy_top_k:          readInt("KB_KEYWORD_FUZZY_TOP_K",        5),
  keyword_fuzzy_min_sim:        readFloat("KB_KEYWORD_FUZZY_MIN_SIM",    0.35),
  topic_match_limit:            readInt("KB_TOPIC_MATCH_LIMIT",          5),
  graphrag_limit:               readInt("KB_GRAPHRAG_LIMIT",             5),
  topic_neighbors_limit:        readInt("KB_TOPIC_NEIGHBORS_LIMIT",      10),
  topic_merge_limit:            readInt("KB_TOPIC_MERGE_LIMIT",          5),
  topic_extract_truncate_chars: readInt("KB_TOPIC_EXTRACT_TRUNCATE_CHARS", 1500),
  guided_filters_cap:           readInt("KB_GUIDED_FILTERS_CAP",        5),
  metadata_fuzzy_limit:         readInt("KB_METADATA_FUZZY_LIMIT",      5),
  metadata_fuzzy_min_sim:       readFloat("KB_METADATA_FUZZY_MIN_SIM",  0.25),
  subworkflows_max:             readInt("KB_SUBWORKFLOWS_MAX",           4),
  subworkflow_timeout_ms:       readInt("KB_SUBWORKFLOW_TIMEOUT_MS",     10000),
  definitions_max_keywords:     readInt("KB_DEFINITIONS_MAX_KEYWORDS",   15),
  definitions_per_keyword:      readInt("KB_DEFINITIONS_PER_KEYWORD",    0),
};

// ─── Per-model override merge ──────────────────────────────────────────────────

/**
 * Return the effective KB workflow config for a given model, applying:
 *   env defaults (KB_CAPS_DEFAULTS)
 *     → workflowDefaults.kb (model_config.js)
 *       → model workflowOverrides.kb
 *
 * Returned object is a plain flat key-value map; consumers read specific keys.
 */
export function getKbWorkflowConfig(modelId) {
  const workflowDefaultsKb = MODEL_ROUTING_CONFIG.workflowDefaults?.kb || {};
  const model = MODEL_ROUTING_CONFIG.models.find((m) => m.id === modelId);
  const modelKbOverrides = model?.workflowOverrides?.kb || {};
  return {
    ...KB_CAPS_DEFAULTS,
    ...workflowDefaultsKb,
    ...modelKbOverrides,
  };
}
