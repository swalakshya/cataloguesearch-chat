import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { log } from "../utils/log.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROMPT_ROOT = path.resolve(__dirname, "../../prompts");
const cache = new Map();

function readPrompt(relPath) {
  const absPath = path.join(PROMPT_ROOT, relPath);
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
  return template
    .replace("<QUESTION_HERE>", question)
    .replace("<CONVERSATION_HISTORY_HERE>", conversationHistory || "[]")
    .trim();
}

export function getAnswerPrompt(question, context, workflowGuidelines, conversationHistory) {
  const base = readPrompt("step_2_answer_synthesis.md");
  const composed = [base, workflowGuidelines].filter(Boolean).join("\n\n");
  return composed
    .replace("<QUESTION_HERE>", question)
    .replace("<CONVERSATION_HISTORY_HERE>", conversationHistory || "[]")
    .replace("<CONTEXT_HERE>", context || "");
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
