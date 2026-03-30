import { workflowRegistry } from "./workflow_registry.js";
import { log } from "../utils/log.js";

export class ToolBudget {
  constructor(limit) {
    this.limit = limit;
    this.used = 0;
  }

  consume() {
    this.used += 1;
  }

  remaining() {
    return Math.max(0, this.limit - this.used);
  }
}

export async function runWorkflow({ externalApi, keywordResult, requestId }) {
  const workflowName = keywordResult.workflow || "basic_question_v1";
  const runner = workflowRegistry[workflowName];
  if (!runner) {
    throw new Error(`Unknown workflow: ${workflowName}`);
  }

  log.info("workflow_start", { requestId, workflow: workflowName });

  const resolvedFilters = await resolveFilters({
    externalApi,
    filters: keywordResult.filters || {},
    language: keywordResult.language || "hi",
    requestId,
    allowFailure: workflowName !== "basic_question_v1",
  });

  const params = {
    ...keywordResult,
    filters: resolvedFilters,
  };

  const toolBudgetLimit = Number(process.env.WORKFLOW_TOOL_CALL_BUDGET || 25);
  const toolBudget = new ToolBudget(toolBudgetLimit);

  const chunks = await runner({ externalApi, params, requestId, toolBudget });

  log.info("workflow_complete", {
    requestId,
    workflow: workflowName,
    retrievedChunks: Array.isArray(chunks) ? chunks.length : 0,
    toolCallsUsed: toolBudget.used,
    toolCallBudget: toolBudget.limit,
  });

  return { workflowName, chunks };
}

async function resolveFilters({ externalApi, filters, language, requestId, allowFailure }) {
  if (!filters || typeof filters !== "object") return {};
  const hasAnyFilter = Boolean(
    filters.granth ||
      filters.anuyog ||
      filters.contributor ||
      filters.content_type ||
      filters.year_from ||
      filters.year_to
  );
  if (!hasAnyFilter) return {};

  const typesToFetch = normalizeContentTypes(filters.content_type);
  const optionSets = [];

  for (const ct of typesToFetch) {
    optionSets.push(
      await safeFetchFilterOptions(externalApi, { language: "hi", content_type: ct }, requestId, allowFailure)
    );
  }

  const merged = mergeFilterOptions(optionSets);
  const resolved = {
    content_type: filters.content_type || undefined,
    granth: resolveMatch(filters.granth, merged.granths),
    anuyog: resolveMatch(filters.anuyog, merged.anuyogs),
    contributor: resolveMatch(filters.contributor, merged.contributors),
    year_from: parseYear(filters.year_from),
    year_to: parseYear(filters.year_to),
  };

  log.debug("filters_resolved", { requestId, input: filters, resolved });
  return stripEmpty(resolved);
}

async function safeFetchFilterOptions(externalApi, payload, requestId, allowFailure) {
  try {
    return await externalApi.getFilterOptions(payload, requestId);
  } catch (err) {
    if (!allowFailure) throw err;
    log.warn("filter_options_failed", {
      requestId,
      error: err?.message || String(err),
      payload,
    });
    return null;
  }
}

function mergeFilterOptions(optionSets) {
  const merged = { granths: [], anuyogs: [], contributors: [] };
  for (const options of optionSets) {
    if (!options) continue;
    merged.granths.push(...(options.granths || []));
    merged.anuyogs.push(...(options.anuyogs || []));
    merged.contributors.push(...(options.contributors || []));
  }
  merged.granths = unique(merged.granths);
  merged.anuyogs = unique(merged.anuyogs);
  merged.contributors = unique(merged.contributors);
  return merged;
}

function unique(list) {
  const seen = new Set();
  const out = [];
  for (const item of list) {
    if (!item) continue;
    if (seen.has(item)) continue;
    seen.add(item);
    out.push(item);
  }
  return out;
}

function resolveMatch(value, options) {
  if (!value) return undefined;
  if (!Array.isArray(options) || options.length === 0) return value;
  const normalized = normalize(value);
  const exact = options.find((opt) => normalize(opt) === normalized);
  if (exact) return exact;
  const contains = options.find((opt) => normalize(opt).includes(normalized));
  return contains || value;
}

function normalize(value) {
  return String(value || "").trim().toLowerCase();
}

const _ALL_CONTENT_TYPES = ["Pravachan", "Granth", "Books"];

function normalizeContentTypes(value) {
  if (!value || (Array.isArray(value) && value.length === 0)) return _ALL_CONTENT_TYPES;
  if (Array.isArray(value)) return value.filter((v) => _ALL_CONTENT_TYPES.includes(v));
  if (_ALL_CONTENT_TYPES.includes(value)) return [value];
  return _ALL_CONTENT_TYPES;
}

function parseYear(value) {
  if (value === null || value === undefined || value === "") return undefined;
  const num = Number(value);
  return Number.isFinite(num) ? num : undefined;
}

function stripEmpty(obj) {
  const cleaned = {};
  for (const [key, value] of Object.entries(obj)) {
    if (value === undefined || value === null || value === "") continue;
    cleaned[key] = value;
  }
  return cleaned;
}
