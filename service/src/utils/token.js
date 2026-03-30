import { DEFAULT_TOKEN_LIMITS } from "../config/token_limits.js";

export function estimateTokens(text) {
  if (!text) return 0;
  const length = String(text).length;
  return Math.max(1, Math.ceil(length / 4));
}

export function getSessionTokenLimit(providerId, model, env = process.env, defaults = DEFAULT_TOKEN_LIMITS) {
  const raw = env.LLM_TOKEN_LIMITS_JSON;
  let parsed = null;
  if (raw) {
    try {
      parsed = JSON.parse(raw);
    } catch {
      parsed = null;
    }
  }
  const config = parsed || defaults;
  if (!config || typeof config !== "object") return null;
  const provider = String(providerId || "").toLowerCase();
  const modelName = String(model || "").toLowerCase();
  const providerConfig = config[provider] || config.default || null;
  if (!providerConfig || typeof providerConfig !== "object") return null;
  const exact = providerConfig[modelName];
  if (Number.isFinite(exact) && exact > 0) return exact;
  const wildcard = providerConfig["*"];
  if (Number.isFinite(wildcard) && wildcard > 0) return wildcard;
  return null;
}

export function shouldRejectForTokenLimit({ currentTokens, incomingText, limit, threshold }) {
  if (!limit || limit <= 0) return false;
  const safeThreshold = typeof threshold === "number" ? threshold : 0.8;
  const projected = currentTokens + estimateTokens(incomingText);
  return projected >= Math.floor(limit * safeThreshold);
}
