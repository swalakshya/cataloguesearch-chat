import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { getAllowedContentTypes, getDefaultContentTypes } from "../config/content_types.js";
import { log } from "../utils/log.js";
import { recordPromptRootForTest } from "../testing/test_prompt_roots.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export function isPromptV2(env = process.env) {
  return String(env.LLM_PROMPT_VERSION || "v2").toLowerCase() === "v2";
}

const cache = new Map();
const interpolatedCache = new Map();

function normalizeModelId(modelId) {
  return String(modelId || "").replace(/\./g, "_");
}

function resolvePromptRoots({ modelId, promptVersion, overrideRoot, questionId } = {}) {
  const version = promptVersion || (isPromptV2() ? "v2" : "v1");
  const baseFolder = version === "v2" ? "prompts_v2" : "prompts";
  const baseRoot = overrideRoot
    ? path.resolve(overrideRoot, baseFolder)
    : path.resolve(__dirname, `../../prompts_sets/${baseFolder}`);
  const roots = [];
  if (modelId) {
    const safeModelId = normalizeModelId(modelId);
    const modelFolder = `${baseFolder}_${safeModelId}`;
    const modelRoot = overrideRoot
      ? path.resolve(overrideRoot, modelFolder)
      : path.resolve(__dirname, `../../prompts_sets/${modelFolder}`);
    roots.push(modelRoot);
  }
  roots.push(baseRoot);
  if (questionId) {
    recordPromptRootForTest({ questionId, modelId, promptRoot: roots[0] });
  }
  return roots;
}

export function getPromptRootForModel({ modelId, promptVersion } = {}) {
  const roots = resolvePromptRoots({ modelId, promptVersion });
  return roots[0] || null;
}

function readPrompt(relPath, options) {
  const roots = resolvePromptRoots(options);
  for (const root of roots) {
    const absPath = path.join(root, relPath);
    if (cache.has(absPath)) return interpolatePrompt(cache.get(absPath), absPath, options?.env);
    try {
      const text = fs.readFileSync(absPath, "utf-8").trim();
      cache.set(absPath, text);
      return interpolatePrompt(text, absPath, options?.env);
    } catch {
      // Try next root.
    }
  }
  log.warn("prompt_read_failed", {
    paths: roots.map((root) => path.join(root, relPath)),
  });
  return "";
}

function interpolatePrompt(text, cacheKey, env = process.env) {
  if (!text) return "";
  const interpolationKey = JSON.stringify({
    cacheKey,
    defaultContentTypes: env?.LLM_DEFAULT_CONTENT_TYPES || "",
    allowedContentTypes: env?.LLM_ALLOWED_CONTENT_TYPES || "",
  });
  const cached = interpolatedCache.get(interpolationKey);
  if (cached) return cached;
  const defaultContentTypes = getDefaultContentTypes(env);
  const allowedContentTypes = getAllowedContentTypes(env);
  const resolved = String(text)
    .replace(/<DEFAULT_CONTENT_TYPES_JSON>/g, JSON.stringify(defaultContentTypes))
    .replace(/<ALLOWED_CONTENT_TYPES_JSON>/g, JSON.stringify(allowedContentTypes))
    .replace(/<ALLOWED_CONTENT_TYPES_PIPE>/g, allowedContentTypes.join("|"))
    .replace(/<ALLOWED_CONTENT_TYPES_OR>/g, allowedContentTypes.map((value) => `"${value}"`).join(" or "));
  interpolatedCache.set(interpolationKey, resolved);
  return resolved;
}

export function getKeywordPrompt(question, conversationHistory, options = {}) {
  const template = readPrompt("step_1_keyword_extract_and_classification.md", options);
  const historyBlock = readPrompt("conversation_history.md", options);
  return [
    template.replace("<QUESTION_HERE>", question).trim(),
    historyBlock,
    conversationHistory || "[]",
  ]
    .filter(Boolean)
    .join("\n\n")
    .trim();
}

export function getKeywordFixPrompt(question, step1Json, options = {}) {
  const template = readPrompt("step_1b_keyword_fix.md", options);
  return template
    .replace("<QUESTION_HERE>", question)
    .replace("<STEP1_JSON_HERE>", JSON.stringify(step1Json, null, 2))
    .trim();
}

export function getAnswerPrompt(
  question,
  context,
  workflowGuidelines,
  conversationHistory,
  workflowName = "",
  language = "",
  script = "",
  options = {}
) {
  const base =
    workflowName === "metadata_question_v1"
      ? readPrompt("step_2_metadata_answer_synthesis.md", options)
      : readPrompt("step_2_answer_synthesis.md", options);
  const composed = [base, workflowGuidelines].filter(Boolean).join("\n\n");
  const historyBlock = readPrompt("conversation_history.md", options);
  const historySection = conversationHistory && String(conversationHistory).trim() ? historyBlock : "";
  return [
    composed
      .replace("<QUESTION_HERE>", question)
      .replace("<CONTEXT_HERE>", context || "")
      .replace("<LANGUAGE_HERE>", language || "")
      .replace("<SCRIPT_HERE>", script || "")
      .trim(),
    historySection,
    historySection ? conversationHistory : "",
  ]
    .filter(Boolean)
    .join("\n\n")
    .trim();
}

export function getWorkflowGuidelines(workflowName, options = {}) {
  const mapping = {
    basic_question_v1: "workflow_answering_guidelines/basic_question.md",
    followup_question_v1: "workflow_answering_guidelines/followup_question.md",
    advanced_distinct_questions_v1: "workflow_answering_guidelines/advanced_distinct_questions.md",
    advanced_nested_questions_v1: "workflow_answering_guidelines/advanced_nested_questions.md",
  };
  const relPath = mapping[workflowName] || "";
  return relPath ? readPrompt(relPath, options) : "";
}
