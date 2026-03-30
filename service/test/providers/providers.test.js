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
