import { test } from "node:test";
import assert from "node:assert/strict";

import { LLMProvider } from "../../src/providers/base.js";
import { OpenAIProvider } from "../../src/providers/openai.js";
import { GeminiProvider } from "../../src/providers/gemini.js";

test("LLMProvider methods throw by default", async () => {
  const provider = new LLMProvider();
  await assert.rejects(() => provider.completeText(), /Not implemented/);
  await assert.rejects(() => provider.completeJson(), /Not implemented/);
});

test("OpenAIProvider throws when API key missing", async () => {
  const provider = new OpenAIProvider({ apiKey: "", model: "gpt-4o", timeoutMs: 10 });
  await assert.rejects(
    () => provider.completeText({ messages: [], temperature: 0, requestId: "r1" }),
    /OPENAI_API_KEY/
  );
});

test("GeminiProvider throws when API key missing", async () => {
  const provider = new GeminiProvider({ apiKey: "", model: "gemini", timeoutMs: 10, jsonMode: false });
  await assert.rejects(
    () => provider.completeText({ messages: [], temperature: 0, requestId: "r1" }),
    /GEMINI_API_KEY/
  );
});

test("GeminiProvider refreshes key and retries once on 401", async () => {
  let apiKey = "key-1";
  const keyManager = {
    getKey: () => apiKey,
    refresh: async () => {
      apiKey = "key-2";
      return apiKey;
    },
  };

  const provider = new GeminiProvider({
    apiKey: "",
    model: "gemini",
    timeoutMs: 10,
    jsonMode: false,
    keyManager,
    clientFactory: ({ apiKey }) => ({
      models: {
        generateContent: async () => {
          if (apiKey === "key-1") {
            const err = new Error("Unauthorized");
            err.status = 401;
            throw err;
          }
          return { text: "ok" };
        },
      },
    }),
  });

  const result = await provider.completeText({ messages: [], temperature: 0, requestId: "r1" });
  assert.equal(result.text, "ok");
});

test("GeminiProvider.fromEnv prefers env key over secret manager", async () => {
  process.env.GEMINI_API_KEY = "env-key";
  const provider = GeminiProvider.fromEnv({ keyManager: { getKey: () => "sm-key" } });
  assert.equal(provider.apiKey, "env-key");
  delete process.env.GEMINI_API_KEY;
});

test("OpenAIProvider attaches status on non-200", async () => {
  const provider = new OpenAIProvider({ apiKey: "k", model: "gpt-4o", timeoutMs: 10, jsonMode: false, baseUrl: "http://localhost" });
  const originalFetch = global.fetch;
  global.fetch = async () => ({ ok: false, status: 503, text: async () => "boom" });
  await assert.rejects(
    () => provider.completeText({ messages: [], temperature: 0, requestId: "r1" }),
    (err) => err.status === 503
  );
  global.fetch = originalFetch;
});
