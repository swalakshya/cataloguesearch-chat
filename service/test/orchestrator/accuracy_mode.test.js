import { test } from "node:test";
import assert from "node:assert/strict";
import { runWorkflow } from "../../src/orchestrator/workflow_router.js";
import { retryWorkflowOnEmptyChunks } from "../../src/orchestrator/keyword_fix_retry.js";

for (const workflow of ["basic_question_v1", "followup_question_v1", "advanced_distinct_questions_v1", "advanced_nested_questions_v1"]) {
  for (const accuracyMode of [false, true]) {
    test(`${workflow} forwards accuracy=${accuracyMode} to every bilingual search`, async () => {
      const searches = [];
      const externalApi = {
        search: async (payload) => { searches.push(payload); return []; },
        navigate: async () => [], findSimilar: async () => [],
      };
      await runWorkflow({ externalApi, requestId: "accuracy-test", accuracyMode, gujChunks: true,
        modelId: "gemini-2.5-flash", keywordResult: {
          workflow, language: "hi", filters: {}, keywords: ["आत्मा"], keywords_guj: ["આત્મા"],
          queries: [{ keywords: ["आत्मा"], keywords_guj: ["આત્મા"] }],
          main_query: { keywords: ["आत्मा"], keywords_guj: ["આત્મા"] },
          sub_queries: [{ keywords: ["ज्ञान"], keywords_guj: ["જ્ઞાન"] }],
        } });
      assert.ok(searches.length >= 2);
      assert.ok(searches.some((p) => p.language === "hi"));
      assert.ok(searches.some((p) => p.language === "gu"));
      for (const payload of searches) {
        assert.equal(payload.accuracy_mode, accuracyMode);
        assert.ok(payload.page_size <= 15, "accuracy changes candidates, not returned context size");
      }
    });
  }
}

test("keyword-fix retry preserves accuracy mode on both attempts", async () => {
  const modes = [];
  await retryWorkflowOnEmptyChunks({
    initialKeywordResult: { workflow: "basic_question_v1" }, accuracyMode: true,
    runWorkflowFn: async ({ accuracyMode }) => { modes.push(accuracyMode); return { chunks: [] }; },
    runKeywordFixFn: async () => ({ workflow: "basic_question_v1" }),
  });
  assert.deepEqual(modes, [true, true]);
});
