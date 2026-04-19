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

const WORKFLOW_CONFIG_KEY_MAP = {
  basic_question_v1: "basic",
  followup_question_v1: "followup",
  advanced_distinct_questions_v1: "advanced_distinct",
  advanced_nested_questions_v1: "advanced_nested",
};

export function getWorkflowReferenceCount(workflowName, modelId) {
  const configKey = WORKFLOW_CONFIG_KEY_MAP[workflowName];
  if (!configKey) return undefined;
  const config = getWorkflowConfig(modelId);
  return config[configKey]?.referenceCount;
}
