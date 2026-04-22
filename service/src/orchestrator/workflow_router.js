import { workflowRegistry } from "./workflow_registry.js";
import {
  getDefaultContentTypes,
  hasSameContentTypes,
  sanitizeAllowedContentTypes,
} from "../config/content_types.js";
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

export async function runWorkflow({ externalApi, keywordResult, requestId, provider = null, modelId = null }) {
  const workflowName = keywordResult.workflow || "basic_question_v1";
  const runner = workflowRegistry[workflowName];
  if (!runner) {
    throw new Error(`Unknown workflow: ${workflowName}`);
  }

  log.info("workflow_start", { requestId, workflow: workflowName });

  const isMetadataWorkflow = workflowName === "metadata_question_v1";
  const resolvedFilters = isMetadataWorkflow
    ? keywordResult.filters || {}
    : await resolveFilters({
      externalApi,
      filters: keywordResult.filters || {},
      language: keywordResult.language || "hi",
      requestId,
      allowFailure: workflowName !== "basic_question_v1",
      provider,
    });

  const params = {
    ...keywordResult,
    filters: resolvedFilters,
  };

  const toolBudgetLimit = Number(process.env.WORKFLOW_TOOL_CALL_BUDGET || 25);
  const toolBudget = new ToolBudget(toolBudgetLimit);

  const chunks = await runner({ externalApi, params, requestId, toolBudget, modelId });

  log.info("workflow_complete", {
    requestId,
    workflow: workflowName,
    retrievedChunks: Array.isArray(chunks) ? chunks.length : 0,
    toolCallsUsed: toolBudget.used,
    toolCallBudget: toolBudget.limit,
  });

  return { workflowName, chunks, toolCallsUsed: toolBudget.used };
}

async function resolveFilters({ externalApi, filters, language, requestId, allowFailure, provider }) {
  if (!filters || typeof filters !== "object") return {};
  const hasExplicitFilter = Boolean(
    filters.granth ||
      filters.anuyog ||
      filters.contributor
  );

  const requestedContentTypes = sanitizeAllowedContentTypes(filters.content_type, {
    fallbackToDefault: false,
  });
  const defaultContentTypes = getDefaultContentTypes();
  const isDefaultContentTypes = hasSameContentTypes(requestedContentTypes, defaultContentTypes);

  if (!hasExplicitFilter) {
    if (requestedContentTypes.length && !isDefaultContentTypes) {
      return { content_type: requestedContentTypes };
    }
    return {};
  }

  const typesToFetch = requestedContentTypes.length ? requestedContentTypes : defaultContentTypes;
  const optionSets = [];

  for (const ct of typesToFetch) {
    optionSets.push(
      await safeFetchFilterOptions(externalApi, { language: "hi", content_type: ct }, requestId, allowFailure)
    );
  }

  const merged = mergeFilterOptions(optionSets);
  const granthMatch = resolveMatchWithFlag(filters.granth, merged.granths);
  const anuyogMatch = resolveMatchWithFlag(filters.anuyog, merged.anuyogs);
  const contributorMatch = resolveMatchWithFlag(filters.contributor, merged.contributors);
  let resolved = {
    content_type: requestedContentTypes.length ? requestedContentTypes : undefined,
    granth: granthMatch.value,
    anuyog: anuyogMatch.value,
    contributor: contributorMatch.value,
  };

  const shouldMap =
    provider &&
    hasExplicitFilter &&
    (granthMatch.matched === false ||
      anuyogMatch.matched === false ||
      contributorMatch.matched === false);

  if (shouldMap) {
    const mapped = await mapFiltersWithLlm({
      provider,
      requestId,
      original: {
        granth: filters.granth || "",
        anuyog: filters.anuyog || "",
        contributor: filters.contributor || "",
      },
      options: merged,
    });
    resolved = {
      ...resolved,
      granth: granthMatch.matched === false && mapped.granth ? mapped.granth : resolved.granth,
      anuyog: anuyogMatch.matched === false && mapped.anuyog ? mapped.anuyog : resolved.anuyog,
      contributor:
        contributorMatch.matched === false && mapped.contributor ? mapped.contributor : resolved.contributor,
    };
    log.info("filters_llm_mapped", { requestId, input: filters, mapped, resolved });
  }

  log.verbose("filters_resolved", { requestId, input: filters, resolved });
  return stripEmpty(resolved);
}

async function safeFetchFilterOptions(externalApi, payload, requestId, allowFailure) {
  try {
    const response = await externalApi.getFilterOptions(payload, requestId);
    log.verbose("filter_options_response", { requestId, payload, response });
    return response;
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

function resolveMatchWithFlag(value, options) {
  if (!value) return { value: undefined, matched: null };
  if (!Array.isArray(options) || options.length === 0) return { value, matched: null };
  const normalized = normalize(value);
  const exact = options.find((opt) => normalize(opt) === normalized);
  if (exact) return { value: exact, matched: true };
  const contains = options.find((opt) => normalize(opt).includes(normalized));
  if (contains) return { value: contains, matched: true };
  return { value, matched: false };
}

async function mapFiltersWithLlm({ provider, requestId, original, options }) {
  const system = "You map filter values to the closest valid option. Output JSON only.";
  const user = [
    "Map each provided filter to the best matching option from the lists.",
    "If no good match, return empty string for that field.",
    "",
    `Original filters: ${JSON.stringify(original)}`,
    `Options: ${JSON.stringify(options)}`,
    "",
    "Output JSON schema:",
    '{\"granth\":\"<string>\",\"anuyog\":\"<string>\",\"contributor\":\"<string>\"}',
  ].join("\\n");

  const schema = {
    type: "object",
    properties: {
      granth: { type: "string" },
      anuyog: { type: "string" },
      contributor: { type: "string" },
    },
    required: ["granth", "anuyog", "contributor"],
    additionalProperties: false,
  };

  const raw = await provider.completeJson({
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    temperature: 0,
    requestId,
    responseJsonSchema: schema,
  });

  try {
    return JSON.parse(raw);
  } catch (err) {
    log.warn("filters_llm_map_parse_failed", { requestId, error: err?.message || String(err) });
    return { granth: "", anuyog: "", contributor: "" };
  }
}

function normalize(value) {
  return String(value || "").trim().toLowerCase();
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
