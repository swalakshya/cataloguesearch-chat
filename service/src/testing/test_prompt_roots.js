const TEST_MODE = String(process.env.TEST_MODE || "").toLowerCase() === "true";
const promptRootsByRequest = new Map();

export function recordPromptRootForTest({ questionId, modelId, promptRoot }) {
  if (!TEST_MODE || !questionId) return;
  promptRootsByRequest.set(questionId, {
    questionId,
    modelId: modelId || null,
    promptRoot,
  });
}

export function getPromptRootForTest(questionId) {
  if (!TEST_MODE) return null;
  return promptRootsByRequest.get(questionId) || null;
}

export function resetPromptRootsForTest() {
  if (!TEST_MODE) return;
  promptRootsByRequest.clear();
}
