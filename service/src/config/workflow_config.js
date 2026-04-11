import { MODEL_ROUTING_CONFIG } from "../config/model_config.js";

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function deepMerge(base, override) {
  const out = { ...base };
  if (!override || !isObject(override)) return out;
  for (const [key, value] of Object.entries(override)) {
    if (isObject(value)) {
      out[key] = deepMerge(base[key] || {}, value);
    } else {
      out[key] = value;
    }
  }
  return out;
}

export function getWorkflowConfig(modelId) {
  const defaults = MODEL_ROUTING_CONFIG.workflowDefaults || {};
  const model = MODEL_ROUTING_CONFIG.models.find((entry) => entry.id === modelId);
  const overrides = modelId ? model?.workflowOverrides || {} : {};
  return deepMerge(defaults, overrides);
}
