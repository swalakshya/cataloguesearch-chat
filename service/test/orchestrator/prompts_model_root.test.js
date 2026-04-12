import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";
import { getKeywordPrompt } from "../../src/orchestrator/prompts.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

test("getKeywordPrompt prefers model-specific folder when present", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "prompts-"));
  const baseRoot = path.join(tmp, "prompts_v2");
  const modelRoot = path.join(tmp, "prompts_v2_gemini-2_5-flash");

  fs.mkdirSync(baseRoot, { recursive: true });
  fs.mkdirSync(modelRoot, { recursive: true });
  fs.writeFileSync(path.join(baseRoot, "step_1_keyword_extract_and_classification.md"), "BASE <QUESTION_HERE>");
  fs.writeFileSync(path.join(baseRoot, "conversation_history.md"), "HISTORY");
  fs.writeFileSync(path.join(modelRoot, "step_1_keyword_extract_and_classification.md"), "MODEL <QUESTION_HERE>");
  fs.writeFileSync(path.join(modelRoot, "conversation_history.md"), "HISTORY");

  const prompt = getKeywordPrompt("Q", "[]", {
    modelId: "gemini-2.5-flash",
    overrideRoot: tmp,
    promptVersion: "v2",
  });

  assert.ok(prompt.includes("MODEL Q"));
});
