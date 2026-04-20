import { runWorkflow } from "./workflow_router.js";
import { runKeywordFix } from "./keyword_fix.js";

export async function retryWorkflowOnEmptyChunks({
  initialKeywordResult,
  question,
  questionId,
  provider,
  externalApi,
  modelId,
  runWorkflowFn = runWorkflow,
  runKeywordFixFn = runKeywordFix,
  prepareKeywordResult = (result) => result,
}) {
  const preparedInitial = prepareKeywordResult(initialKeywordResult);
  const first = await runWorkflowFn({
    externalApi,
    keywordResult: preparedInitial,
    questionId,
    provider,
    modelId,
  });
  const initialChunks = Array.isArray(first.chunks) ? first.chunks : [];
  if (initialChunks.length > 0) {
    return { ...first, keywordResult: preparedInitial, keywordFixApplied: false };
  }

  const fixedKeywordResult = await runKeywordFixFn({
    provider,
    question,
    step1Json: initialKeywordResult,
    questionId,
    modelId,
  });
  const preparedFixed = prepareKeywordResult(fixedKeywordResult);
  const second = await runWorkflowFn({
    externalApi,
    keywordResult: preparedFixed,
    questionId,
    provider,
    modelId,
  });
  return { ...second, keywordResult: preparedFixed, keywordFixApplied: true };
}
