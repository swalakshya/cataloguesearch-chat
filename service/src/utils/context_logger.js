import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ENABLED = process.env.SAVE_CONTEXT_LOGS === "true";

const LOG_DIR = process.env.LOGS_DIR
  ? path.join(process.env.LOGS_DIR, "contexts")
  : path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      "../../../logs/contexts"
    );

let _dirReady = false;

function ensureDir() {
  if (_dirReady) return;
  fs.mkdirSync(LOG_DIR, { recursive: true });
  _dirReady = true;
}

/**
 * Writes context + question to logs/contexts/<requestId>.md when SAVE_CONTEXT_LOGS=true.
 * Failures are silently swallowed so they never affect the request path.
 */
export function saveContextLog({ requestId, sessionId, question, context }) {
  if (!ENABLED) return;
  try {
    ensureDir();
    const ts = new Date().toISOString();
    const filename = `${ts.replace(/[:.]/g, "-")}_${requestId}.md`;
    const body = [
      `# Context Log`,
      ``,
      `- **requestId**: ${requestId}`,
      `- **sessionId**: ${sessionId}`,
      `- **timestamp**: ${ts}`,
      ``,
      `## Question`,
      ``,
      question || "(empty)",
      ``,
      `## Context`,
      ``,
      context || "(empty)",
      ``,
    ].join("\n");
    fs.writeFileSync(path.join(LOG_DIR, filename), body, "utf8");
  } catch {
    // intentionally silent — debug logging must never break the request
  }
}
