import { test } from "node:test";
import assert from "node:assert/strict";
import { ProviderFactory } from "../../src/providers/provider_factory.js";

const fakeFetcher = async () => "sm-key";

test("ProviderFactory resolves key per model when env key missing", async () => {
  process.env.GCP_PROJECT_ID = "p1";
  process.env.GCP_SA_KEY_PATH = "/tmp/fake.json";
  process.env.GCP_SECRET_VERSION = "latest";
  const factory = new ProviderFactory({
    secretAccessorFactory: () => fakeFetcher,
  });

  const provider = await factory.getProvider({ providerId: "openai", modelId: "gpt-4o" });
  assert.equal(provider.apiKey, "sm-key");
  delete process.env.GCP_PROJECT_ID;
  delete process.env.GCP_SA_KEY_PATH;
  delete process.env.GCP_SECRET_VERSION;
});
