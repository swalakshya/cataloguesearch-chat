const TEST_MODE = String(process.env.TEST_MODE || "").toLowerCase() === "true";
const promptRootsByRequest = new Map();

export function recordPromptRootForTest({ requestId, modelId, promptRoot }) {
  if (!TEST_MODE || !requestId) return;
  promptRootsByRequest.set(requestId, {
    requestId,
    modelId: modelId || null,
    promptRoot,
  });
}

export function getPromptRootForTest(requestId) {
  if (!TEST_MODE) return null;
  return promptRootsByRequest.get(requestId) || null;
}

export function resetPromptRootsForTest() {
  if (!TEST_MODE) return;
  promptRootsByRequest.clear();
}
