import { mkdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const LOCK_DIR = path.join(os.tmpdir(), "cataloguesearch-chat-integration.lock");

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function acquireIntegrationLock({ timeoutMs = 30_000, retryMs = 100 } = {}) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      await mkdir(LOCK_DIR);
      let released = false;
      return async () => {
        if (released) return;
        released = true;
        await rm(LOCK_DIR, { recursive: true, force: true });
      };
    } catch (err) {
      if (err?.code !== "EEXIST") throw err;
    }
    await sleep(retryMs);
  }
  throw new Error("integration_lock_timeout");
}
