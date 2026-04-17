import { pathToFileURL } from "node:url";

import { createServer } from "./server_factory.js";
import { buildHashedChunks, getChunkHash, mapHashedIdsToReal } from "./utils/chunk_hash.js";

export { createServer } from "./server_factory.js";

export function buildHashedChunksForTest(chunks, session) {
  return buildHashedChunks(chunks, session);
}

export function getChunkHashForTest(session, realId) {
  return getChunkHash(session, realId);
}

export function mapHashedIdsToRealForTest(ids, session) {
  return mapHashedIdsToReal(ids, session);
}

if (isMainModule(import.meta.url)) {
  const server = createServer();
  server.start().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

function isMainModule(metaUrl) {
  if (!process.argv[1]) return false;
  return metaUrl === pathToFileURL(process.argv[1]).href;
}
