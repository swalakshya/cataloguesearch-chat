import { runWorkflow } from "./workflow_router.js";
import { runKeywordFix } from "./keyword_fix.js";
import { log } from "../utils/log.js";

export async function retryWorkflowOnEmptyChunks({
  initialKeywordResult,
  question,
  requestId,
  provider,
  externalApi,
  modelId,
  gujChunks = false,
  llmCallsCollector,
  runWorkflowFn = runWorkflow,
  runKeywordFixFn = runKeywordFix,
  prepareKeywordResult = (result) => result,
}) {
  const preparedInitial = prepareKeywordResult(initialKeywordResult);
  const first = await runWorkflowFn({
    externalApi,
    keywordResult: preparedInitial,
    requestId,
    provider,
    modelId,
    gujChunks,
    llmCallsCollector,
  });
  const initialChunks = Array.isArray(first.chunks) ? first.chunks : [];
  if (initialChunks.length > 0) {
    return {
      ...first,
      toolCallsUsed: Number(first.toolCallsUsed) || 0,
      keywordResult: preparedInitial,
      keywordFixApplied: false,
    };
  }

  log.info("keyword_fix_retry_triggered", {
    requestId,
    reason: "empty_chunks",
    workflow: initialKeywordResult?.workflow,
  });

  const fixedKeywordResult = await runKeywordFixFn({
    provider,
    question,
    step1Json: initialKeywordResult,
    requestId,
    modelId,
    gujChunks,
    llmCallsCollector,
  });
  const preparedFixed = prepareKeywordResult(fixedKeywordResult);
  const second = await runWorkflowFn({
    externalApi,
    keywordResult: preparedFixed,
    requestId,
    provider,
    modelId,
    gujChunks,
    llmCallsCollector,
  });
  return {
    ...second,
    toolCallsUsed: (Number(first.toolCallsUsed) || 0) + (Number(second.toolCallsUsed) || 0),
    keywordResult: preparedFixed,
    keywordFixApplied: true,
  };
}
