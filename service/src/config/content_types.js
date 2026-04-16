import { log } from "../utils/log.js";

const FALLBACK_CONTENT_TYPES = ["Granth", "Books"];

export function parseContentTypes(value) {
  if (Array.isArray(value)) {
    return dedupeContentTypes(value);
  }
  if (typeof value === "string") {
    return dedupeContentTypes(value.split(","));
  }
  return [];
}

export function getDefaultContentTypes(env = process.env) {
  const raw = env.LLM_DEFAULT_CONTENT_TYPES;
  const parsed = parseContentTypes(raw || "");
  warnOnMisconfiguredContentTypes({
    raw,
    parsed,
    envKey: "LLM_DEFAULT_CONTENT_TYPES",
  });
  return parsed.length ? parsed : [...FALLBACK_CONTENT_TYPES];
}

export function getAllowedContentTypes(env = process.env) {
  const raw = env.LLM_ALLOWED_CONTENT_TYPES;
  const parsed = parseContentTypes(raw || "");
  warnOnMisconfiguredContentTypes({
    raw,
    parsed,
    envKey: "LLM_ALLOWED_CONTENT_TYPES",
  });
  if (parsed.length) return parsed;
  return dedupeContentTypes([...getDefaultContentTypes(env), ...FALLBACK_CONTENT_TYPES]);
}

export function normalizeContentTypes(value, { env = process.env, fallbackToDefault = true } = {}) {
  return sanitizeAllowedContentTypes(value, { env, fallbackToDefault });
}

export function sanitizeAllowedContentTypes(value, { env = process.env, fallbackToDefault = true } = {}) {
  const parsed = parseContentTypes(value);
  const allowed = new Set(getAllowedContentTypes(env));
  const filtered = parsed.filter((contentType) => allowed.has(contentType));
  if (filtered.length) return filtered;
  return fallbackToDefault ? getDefaultContentTypes(env) : [];
}

export function hasSameContentTypes(left, right) {
  const normalizedLeft = parseContentTypes(left);
  const normalizedRight = parseContentTypes(right);
  if (normalizedLeft.length !== normalizedRight.length) return false;
  const rightSet = new Set(normalizedRight);
  return normalizedLeft.every((value) => rightSet.has(value));
}

function dedupeContentTypes(values) {
  const seen = new Set();
  const normalized = [];
  for (const value of values) {
    const contentType = String(value || "").trim();
    if (!contentType || seen.has(contentType)) continue;
    seen.add(contentType);
    normalized.push(contentType);
  }
  return normalized;
}

function warnOnMisconfiguredContentTypes({ raw, parsed, envKey }) {
  if (raw === undefined || raw === null) return;
  if (typeof raw !== "string") return;
  if (parsed.length) return;
  if (!raw.trim()) return;
  log.warn("content_types_env_invalid", {
    envKey,
    value: raw,
    fallback: FALLBACK_CONTENT_TYPES,
  });
}
