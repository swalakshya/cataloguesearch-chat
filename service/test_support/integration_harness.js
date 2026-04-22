import { rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { createServer } from "../src/server.js";

export function isIntegrationEnabled() {
  return String(process.env.TEST_MODE || "").trim().toLowerCase() === "true";
}

export function createIntegrationHarness(label) {
  const dbPath = path.join(
    os.tmpdir(),
    `cataloguesearch-chat-${sanitizeLabel(label)}-${process.pid}-${Date.now()}.db`
  );

  let server = null;
  let baseUrl = "";

  return {
    dbPath,
    get baseUrl() {
      return baseUrl;
    },
    async start() {
      server = createServer({
        testMode: true,
        cleanSessionDb: false,
        chatDbPath: dbPath,
        port: 0,
        host: "127.0.0.1",
      });
      await server.start({ port: 0, host: "127.0.0.1" });
      baseUrl = server.getBaseUrl() || "";
    },
    async stop() {
      await server?.stop?.();
      await cleanupDbFiles(dbPath);
      server = null;
      baseUrl = "";
    },
    async reset() {
      return post(baseUrl, "/v1/test/reset");
    },
    async post(route, body) {
      return post(baseUrl, route, body);
    },
    async get(route) {
      return get(baseUrl, route);
    },
    async postStream(route, body) {
      return postStream(baseUrl, route, body);
    },
  };
}

export async function post(baseUrl, route, body) {
  const res = await fetch(`${baseUrl}${route}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body || {}),
    signal: AbortSignal.timeout(10_000),
  });
  const json = await res.json();
  return { res, json };
}

export async function get(baseUrl, route) {
  const res = await fetch(`${baseUrl}${route}`, {
    signal: AbortSignal.timeout(10_000),
  });
  const json = await res.json();
  return { res, json };
}

export async function postStream(baseUrl, route, body) {
  const res = await fetch(`${baseUrl}${route}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body || {}),
    signal: AbortSignal.timeout(10_000),
  });

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const events = [];

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";
    for (const line of lines) {
      if (!line.startsWith("data: ")) continue;
      events.push(JSON.parse(line.slice(6)));
    }
  }

  return { res, events };
}

async function cleanupDbFiles(dbPath) {
  for (const target of [dbPath, `${dbPath}-wal`, `${dbPath}-shm`]) {
    await rm(target, { force: true });
  }
}

function sanitizeLabel(label) {
  return String(label || "integration")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "integration";
}
