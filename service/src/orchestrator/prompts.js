import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { log } from "../utils/log.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export function isPromptV2(env = process.env) {
  return String(env.LLM_PROMPT_VERSION || "v2").toLowerCase() === "v2";
}

const cache = new Map();

function getPromptRoot() {
  return path.resolve(
    __dirname,
    isPromptV2() ? "../../prompts_v2" : "../../prompts"
  );
}

function readPrompt(relPath) {
  const absPath = path.join(getPromptRoot(), relPath);
  if (cache.has(absPath)) return cache.get(absPath);
  try {
    const text = fs.readFileSync(absPath, "utf-8").trim();
    cache.set(absPath, text);
    return text;
  } catch (err) {
    log.warn("prompt_read_failed", { path: absPath, message: err?.message || String(err) });
    cache.set(absPath, "");
    return "";
  }
}

export function getKeywordPrompt(question, conversationHistory) {
  const template = readPrompt("step_1_keyword_extract_and_classification.md");
  const historyBlock = readPrompt("conversation_history.md");
  return [
    template.replace("<QUESTION_HERE>", question).trim(),
    historyBlock,
    conversationHistory || "[]",
  ]
    .filter(Boolean)
    .join("\n\n")
    .trim();
}

export function getAnswerPrompt(
  question,
  context,
  workflowGuidelines,
  conversationHistory,
  workflowName = "",
  language = "",
  script = ""
) {
  const base =
    workflowName === "metadata_question_v1"
      ? readPrompt("step_2_metadata_answer_synthesis.md")
      : readPrompt("step_2_answer_synthesis.md");
  const composed = [base, workflowGuidelines].filter(Boolean).join("\n\n");
  const historyBlock = readPrompt("conversation_history.md");
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

export function getWorkflowGuidelines(workflowName) {
  const mapping = {
    basic_question_v1: "workflow_answering_guidelines/basic_question.md",
    followup_question_v1: "workflow_answering_guidelines/followup_question.md",
    advanced_distinct_questions_v1: "workflow_answering_guidelines/advanced_distinct_questions.md",
    advanced_nested_questions_v1: "workflow_answering_guidelines/advanced_nested_questions.md",
  };
  const relPath = mapping[workflowName] || "";
  return relPath ? readPrompt(relPath) : "";
}
