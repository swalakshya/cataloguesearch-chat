function readNumberEnv(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === null || String(raw).trim() === "") return fallback;
  const value = Number(raw);
  return Number.isFinite(value) ? value : fallback;
}

function readBoolEnv(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === null || String(raw).trim() === "") return fallback;
  const normalized = String(raw).trim().toLowerCase();
  if (["true", "1", "yes"].includes(normalized)) return true;
  if (["false", "0", "no"].includes(normalized)) return false;
  return fallback;
}

export const WORKFLOW_CONFIG = {
  basic: {
    page: readNumberEnv("WF_BASIC_PAGE", 1),
    page_size: readNumberEnv("WF_BASIC_PAGE_SIZE", 15),
    rerank: readBoolEnv("WF_BASIC_RERANK", true),
  },
  followup: {
    page: readNumberEnv("WF_FOLLOWUP_PAGE", 1),
    page_size: readNumberEnv("WF_FOLLOWUP_PAGE_SIZE", 10),
    rerank: readBoolEnv("WF_FOLLOWUP_RERANK", true),
    navigate_steps: readNumberEnv("WF_FOLLOWUP_NAVIGATE_STEPS", 3),
    navigate_direction: process.env.WF_FOLLOWUP_NAVIGATE_DIRECTION || "both",
    expand_limit: readNumberEnv("WF_FOLLOWUP_EXPAND_LIMIT", 10),
  },
  advanced_distinct: {
    page: readNumberEnv("WF_ADV_DISTINCT_PAGE", 1),
    page_size: readNumberEnv("WF_ADV_DISTINCT_PAGE_SIZE", 10),
    rerank: readBoolEnv("WF_ADV_DISTINCT_RERANK", true),
  },
  advanced_nested: {
    page: readNumberEnv("WF_ADV_NESTED_PAGE", 1),
    page_size: readNumberEnv("WF_ADV_NESTED_PAGE_SIZE", 10),
    rerank: readBoolEnv("WF_ADV_NESTED_RERANK", true),
  },
};
