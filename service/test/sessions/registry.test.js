import { test } from "node:test";
import assert from "node:assert/strict";

import { SessionRegistry } from "../../src/sessions/registry.js";

test("SessionRegistry create/get/close", () => {
  const registry = new SessionRegistry(1_000_000);
  clearInterval(registry.timer);
  let closed = false;
  const provider = { closeSession: () => (closed = true) };
  registry.create({
    sessionId: "s1",
    provider,
    providerSessionId: "p1",
    lastActivityAt: Date.now(),
  });

  assert.equal(registry.get("s1").sessionId, "s1");
  registry.close("s1");
  assert.equal(registry.get("s1"), null);
  assert.equal(closed, true);
});
