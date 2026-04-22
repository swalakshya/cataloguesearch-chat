import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { log, maskKey, resetLogStateForTest, summarize } from "../../src/utils/log.js";

test("maskKey hides most characters", () => {
  assert.equal(maskKey("abcdef"), "***");
  assert.equal(maskKey("abcdefghijk"), "abcd...jk");
});

test("summarize handles arrays and circular data", () => {
  const value = { a: [1, 2, 3] };
  value.self = value;
  const result = summarize(value, 200);
  assert.ok(result.includes("[Circular]"));
});

test("writes verbose and info file logs while keeping console threshold separate", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "chat-log-test-"));
  const originalLogLevel = process.env.LOG_LEVEL;
  const originalLogsDir = process.env.LOGS_DIR;
  const originalConsoleLog = console.log;
  const originalConsoleError = console.error;
  const consoleMessages = [];
  const consoleErrors = [];

  process.env.LOG_LEVEL = "info";
  process.env.LOGS_DIR = tempDir;
  console.log = (message) => consoleMessages.push(String(message));
  console.error = (message) => consoleErrors.push(String(message));

  try {
    log.verbose("verbose_only", { trace: 1 });
    log.info("info_event", { trace: 2 });
    log.error("error_event", { trace: 3 });
    await resetLogStateForTest();

    const infoLog = await fs.readFile(path.join(tempDir, "info.log"), "utf8");
    const verboseLog = await fs.readFile(path.join(tempDir, "verbose.log"), "utf8");

    assert.equal(consoleMessages.some((line) => line.includes("\"message\":\"verbose_only\"")), false);
    assert.equal(consoleMessages.some((line) => line.includes("\"message\":\"info_event\"")), true);
    assert.equal(consoleErrors.some((line) => line.includes("\"message\":\"error_event\"")), true);

    assert.equal(infoLog.includes("\"message\":\"verbose_only\""), false);
    assert.equal(infoLog.includes("\"message\":\"info_event\""), true);
    assert.equal(infoLog.includes("\"message\":\"error_event\""), true);

    assert.equal(verboseLog.includes("\"message\":\"verbose_only\""), true);
    assert.equal(verboseLog.includes("\"message\":\"info_event\""), true);
    assert.equal(verboseLog.includes("\"message\":\"error_event\""), true);
  } finally {
    console.log = originalConsoleLog;
    console.error = originalConsoleError;
    await resetLogStateForTest();
    if (originalLogLevel === undefined) delete process.env.LOG_LEVEL;
    else process.env.LOG_LEVEL = originalLogLevel;
    if (originalLogsDir === undefined) delete process.env.LOGS_DIR;
    else process.env.LOGS_DIR = originalLogsDir;
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});
