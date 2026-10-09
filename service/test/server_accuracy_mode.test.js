import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "../src/server.js";

test("chat message retries distinguish accuracy mode and validate it before replay", async () => {
  const server = createServer({ testMode: true, chatDbPath: "", jwtSecret: "", port: 0, host: "127.0.0.1" });
  try {
    await server.start({ port: 0, host: "127.0.0.1" });
    const baseUrl = server.getBaseUrl();
    const post = async (route, body) => fetch(`${baseUrl}${route}`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
      signal: AbortSignal.timeout(10_000),
    });
    const session = await (await post("/v1/chat/sessions", { provider: "auto" })).json();
    const route = `/v1/chat/sessions/${session.session_id}/messages`;
    const body = { role: "user", content: "What is dharma?", client_message_id: "standard-message" };
    const submitted = await post(route, body);
    assert.equal(submitted.status, 202);
    const deadline = Date.now() + 10_000;
    let result;
    do {
      await new Promise((resolve) => setTimeout(resolve, 20));
      result = await fetch(`${baseUrl}${route}/standard-message/result`);
    } while (result.status === 202 && Date.now() < deadline);
    assert.equal(result.status, 200);
    assert.equal((await post(route, { ...body, accuracy_mode: false })).status, 200,
      "explicit Standard retries the historical omitted-mode request");
    const conflict = await post(route, { ...body, accuracy_mode: true });
    assert.equal(conflict.status, 409);
    assert.equal((await conflict.json()).detail, "idempotency_conflict");
    const invalid = await post(route, { ...body, accuracy_mode: "accuracy" });
    assert.equal(invalid.status, 400);
    assert.equal((await invalid.json()).detail, "invalid_accuracy_mode");
  } finally {
    await server.stop();
  }
});
