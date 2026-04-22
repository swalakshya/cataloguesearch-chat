#!/usr/bin/env node

import path from "node:path";

import { migrateRequestLogs } from "../src/request_logs/log_import.js";

async function main() {
  const { dbPath, logPaths, dryRun, help } = parseArgs(process.argv.slice(2));

  if (help) {
    printUsage();
    process.exit(0);
  }

  if (!dbPath) {
    throw new Error("Missing required --db option (or CHAT_DB_PATH env var)");
  }
  if (!logPaths.length) {
    throw new Error("Provide one or more log file paths");
  }

  const summary = await migrateRequestLogs({
    dbPath: path.resolve(dbPath),
    logPaths: logPaths.map((value) => path.resolve(value)),
    dryRun,
  });

  console.log(JSON.stringify(summary, null, 2));
}

function parseArgs(args) {
  const out = {
    dbPath: process.env.CHAT_DB_PATH || "",
    logPaths: [],
    dryRun: false,
    help: false,
  };

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === "--db") {
      out.dbPath = String(args[i + 1] || "").trim();
      i += 1;
      continue;
    }
    if (arg === "--dry-run") {
      out.dryRun = true;
      continue;
    }
    if (arg === "--help" || arg === "-h") {
      out.help = true;
      continue;
    }
    out.logPaths.push(arg);
  }

  return out;
}

function printUsage() {
  console.log([
    "Usage:",
    "  node scripts/migrate-request-logs.js --db /path/to/cataloguesearch-chat.db /path/to/info.log [...more logs]",
    "",
    "Options:",
    "  --db <path>     Destination SQLite file. Falls back to CHAT_DB_PATH.",
    "  --dry-run       Parse logs and print the summary without writing rows.",
    "  --help, -h      Show this help.",
  ].join("\n"));
}

main().catch((err) => {
  console.error(err?.stack || err?.message || String(err));
  process.exit(1);
});
