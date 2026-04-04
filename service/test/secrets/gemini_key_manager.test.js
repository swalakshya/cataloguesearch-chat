import { test } from "node:test";
import assert from "node:assert/strict";

import { buildSecretAccessor } from "../../src/secrets/gcp_secret_manager.js";
import { GeminiKeyManager } from "../../src/secrets/gemini_key_manager.js";

test("buildSecretAccessor returns accessor that reads latest secret payload", async () => {
  const fakeClient = {
    accessSecretVersion: async () => [
      { payload: { data: Buffer.from("secret-value") } },
    ],
  };
  const accessor = buildSecretAccessor({
    projectId: "proj",
    secretName: "gemini-api-key",
    secretVersion: "latest",
    keyFilename: "/run/secrets/sa.json",
    client: fakeClient,
  });
  const value = await accessor();
  assert.equal(value, "secret-value");
});

test("GeminiKeyManager loads key on init and caches it", async () => {
  let calls = 0;
  const fetcher = async () => {
    calls += 1;
    return "key-1";
  };
  const manager = await GeminiKeyManager.create({ fetcher });
  assert.equal(manager.getKey(), "key-1");
  assert.equal(calls, 1);
});

test("GeminiKeyManager refreshes key on demand", async () => {
  let calls = 0;
  const fetcher = async () => {
    calls += 1;
    return calls === 1 ? "key-1" : "key-2";
  };
  const manager = await GeminiKeyManager.create({ fetcher });
  await manager.refresh();
  assert.equal(manager.getKey(), "key-2");
  assert.equal(calls, 2);
});
