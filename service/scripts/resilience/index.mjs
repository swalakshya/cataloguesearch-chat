#!/usr/bin/env node
/**
 * Resilience test CLI
 * Runs all SF1–SF5 tests against a live service at localhost:8012.
 *
 * Usage:
 *   node service/scripts/resilience/index.mjs
 *   SERVICE_URL=http://localhost:8012 node service/scripts/resilience/index.mjs
 *
 * Options (env vars):
 *   SERVICE_URL   — override the default http://localhost:8012
 *   SKIP_SF4_4    — set to "1" to skip the server-restart test
 */

import { runSF1 } from "./sf1.mjs";
import { runSF2 } from "./sf2.mjs";
import { runSF3 } from "./sf3.mjs";
import { runSF4 } from "./sf4.mjs";
import { runSF5 } from "./sf5.mjs";
import { results, waitForHealth, BASE } from "./helpers.mjs";

// Workflow annotations shown in the final report table
const WORKFLOW_MAP = {
  "SF1-1": "basic_question_v1",
  "SF1-2": "basic_question_v1",
  "SF1-3": "basic_question_v1 (idempotency)",
  "SF1-4": "basic_question_v1 (hash mismatch)",
  "SF1-5": "—",
  "SF1-6": "—",
  "SF1-7": "basic_question_v1 (latency)",
  "SF2-1": "basic_question_v1 (stream)",
  "SF2-2": "basic_question_v1 (cursor replay)",
  "SF2-3": "basic_question_v1 (live stream)",
  "SF2-4": "basic_question_v1 (DB replay)",
  "SF2-5": "—",
  "SF2-6": "—",
  "SF3-1": "basic_question_v1 (reconnect)",
  "SF3-2": "basic_question_v1 (reload while processing)",
  "SF3-3": "basic_question_v1 (reload after complete)",
  "SF3-4": "basic_question_v1 (partial replay)",
  "SF3-5": "—",
  "SF4-1": "—",
  "SF4-2": "—",
  "SF4-3": "basic_question_v1 (retry)",
  "SF4-4": "basic_question_v1 (DB persistence)",
  "SF5-1": "basic_question_v1 (concurrent)",
};

const UX_MAP = {
  "SF1-1": "Send accepted immediately",
  "SF1-2": "Wait and receive answer",
  "SF1-3": "Safe retry after send uncertainty",
  "SF1-4": "Reject mismatched duplicate send",
  "SF1-5": "Unknown pending message fails cleanly",
  "SF1-6": "Wrong chat cannot access result",
  "SF1-7": "UI is not blocked by LLM work",
  "SF2-1": "See live progress and final answer",
  "SF2-2": "Reconnect replays missed progress",
  "SF2-3": "Open stream early and still complete",
  "SF2-4": "Refresh/tab reopen replays completed job",
  "SF2-5": "Stale cursor closes harmlessly",
  "SF2-6": "Missing stream target fails cleanly",
  "SF3-1": "Return after interruption and resume",
  "SF3-2": "Reload mid-answer and still recover",
  "SF3-3": "Reload after completion keeps answer",
  "SF3-4": "Resume from partial progress only",
  "SF3-5": "Expired pending state clears cleanly",
  "SF4-1": "Stale session is rejected clearly",
  "SF4-2": "Bad message lookup fails cleanly",
  "SF4-3": "Retry after transient submit issue",
  "SF4-4": "Restart still preserves completed answer",
  "SF5-1": "Two tabs stay consistent",
};

function extractTestId(label) {
  const m = label.match(/^(SF\d+-\d+)\b/);
  return m ? m[1] : null;
}

async function main() {
  console.log(`\n\x1b[1mCatalogueSearch-Chat Resilience Test Suite\x1b[0m`);
  console.log(`Target: ${BASE}\n`);

  // Health check
  process.stdout.write("Checking service health...");
  const healthy = await waitForHealth(15_000);
  if (!healthy) {
    console.log(` \x1b[31mFAIL\x1b[0m — service not reachable at ${BASE}`);
    console.log("Start the service with: npm start (from service/ directory)");
    process.exit(1);
  }
  console.log(` \x1b[32mOK\x1b[0m\n`);

  const groups = [
    { name: "SF1", run: runSF1 },
    { name: "SF2", run: runSF2 },
    { name: "SF3", run: runSF3 },
    { name: "SF4", run: runSF4 },
    { name: "SF5", run: runSF5 },
  ];

  const groupErrors = [];

  for (const { name, run } of groups) {
    try {
      await run();
    } catch (err) {
      console.error(`\n\x1b[31m[${name} unexpected error]\x1b[0m`, err);
      groupErrors.push({ name, err });
    }
  }

  // ── Final report ──────────────────────────────────────────────────────────────
  const SEP   = "─".repeat(132);
  const PASS  = "\x1b[32mPASS\x1b[0m";
  const FAIL  = "\x1b[31mFAIL\x1b[0m";

  console.log(`\n\n${SEP}`);
  console.log(`\x1b[1mTest Report\x1b[0m`);
  console.log(SEP);

  const colW = [8, 42, 30, 34, 6];
  const header = [
    "Test ID".padEnd(colW[0]),
    "Description".padEnd(colW[1]),
    "Workflow".padEnd(colW[2]),
    "User Experience".padEnd(colW[3]),
    "Result",
  ].join("  ");
  console.log(`\x1b[2m${header}\x1b[0m`);
  console.log("─".repeat(132));

  let passed = 0;
  let failed = 0;

  // Group results by test ID
  const byId = new Map();
  for (const r of results) {
    const id = extractTestId(r.label);
    if (!id) continue;
    if (!byId.has(id)) byId.set(id, { ok: true, labels: [] });
    const entry = byId.get(id);
    if (!r.ok) entry.ok = false;
    entry.labels.push(r.label);
  }

  // Print in order
  const orderedIds = Object.keys(WORKFLOW_MAP);
  for (const id of orderedIds) {
    const entry = byId.get(id);
    if (!entry) continue; // test may have been skipped
    const ok = entry.ok;
    if (ok) passed++; else failed++;

    const desc = entry.labels[0] || id;
    const workflow = WORKFLOW_MAP[id] || "—";
    const ux = UX_MAP[id] || "—";
    const status = ok ? PASS : FAIL;

    const shortDesc = desc.replace(/^SF\d+-\d+\s+/, "").slice(0, colW[1] - 1);
    console.log([
      id.padEnd(colW[0]),
      shortDesc.padEnd(colW[1]),
      workflow.padEnd(colW[2]),
      ux.padEnd(colW[3]),
      status,
    ].join("  "));

    if (!ok) {
      const failing = results.filter(r => extractTestId(r.label) === id && !r.ok);
      for (const f of failing) {
        const hint = f.extra ? ` (${f.extra})` : "";
        console.log(`         \x1b[31m↳ ${f.label}${hint}\x1b[0m`);
      }
    }
  }

  // Assertions not mapped to a test ID (miscellaneous)
  const unmapped = results.filter(r => !extractTestId(r.label));
  for (const r of unmapped) {
    const ok = r.ok;
    if (ok) passed++; else failed++;
    const status = ok ? PASS : FAIL;
    console.log(
      `${"(misc)".padEnd(colW[0])}  ${r.label.padEnd(colW[1])}  ${"—".padEnd(colW[2])}  ${"—".padEnd(colW[3])}  ${status}`
    );
  }

  // Unexpected group errors
  for (const { name, err } of groupErrors) {
    failed++;
    console.log(
      `${name.padEnd(colW[0])}  ${"Unexpected exception".padEnd(colW[1])}  ${"—".padEnd(colW[2])}  ${"—".padEnd(colW[3])}  ${FAIL}`
    );
    console.log(`         \x1b[31m↳ ${err.message}\x1b[0m`);
  }

  console.log(SEP);
  const total = passed + failed;
  const summary = failed === 0
    ? `\x1b[32m✓ All ${total} tests passed\x1b[0m`
    : `\x1b[31m✗ ${failed} / ${total} tests failed\x1b[0m`;
  console.log(`\n${summary}\n`);

  process.exit(failed > 0 ? 1 : 0);
}

main().catch(err => {
  console.error("\nUnexpected fatal error:", err);
  process.exit(1);
});
