# Phase 4 (chat) — Guided Filters on the Agent API

Use the merged topics from Phase 3 to derive **guided filters**
(`{shastra, gatha, page}` triples) and pass them to new
cataloguesearch agent API calls. The agent API then runs the user query both
unfiltered (current behaviour) and once per guided-filter set, returning multiple responses for guided filter responses. Chat passes both buckets to
Step2.

The modified agent API contract is specified in
`service/docs/cataloguesearch/tools/cataloguesearch_tools_enhancements.md`
(updated alongside this phase).

## Guided-filter extraction (chat-side)

From merged topics' `references[]` (Phase 3 output):

```js
function deriveGuidedFilters(mergedTopics, cap = 5) {
  const seen = new Set();
  const out = [];
  for (const t of mergedTopics) {
    for (const ref of t.references ?? []) {
      const f = {
        shastra: ref.shastra_natural_key ?? null,
        gatha:   ref.gatha_number       ?? null,
        page:    ref.page_number        ?? null,
        teeka:   ref.teeka_natural_key  ?? null,
      };
      // skip empty
      if (Object.values(f).every(v => v == null)) continue;
      const key = JSON.stringify(f);
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(f);
      if (out.length >= cap) return out;
    }
  }
  return out;
}
```

Cap default: `KB_GUIDED_FILTERS_CAP=5` (env-tunable).

## Workflow integration

`external_search` calls in every retrieval workflow now look like:

```js
agent_api.search({
  query: ...,
  language: ...,
  filters: userExtractedFilters,
  page_size: ...,
  page: 1,
  rerank: true,
})
```

```js
for each guided_filter in guided_filters from deriveGuidedFilters:
  agent_api.search({
    query: ...,
    language: ...,
    filters: guided_filter,
    page_size: 3, // use page size 3 (configurable)
    page: 1,
    rerank: true,
})
```

Chat passes both `results[]` and `guided_results[]`
to Step2, **labelled** so the LLM can prefer guided hits when consistent
with the question.

## Step2 context layout

```
### Vector Passages (default)
[chunk_1] …
[chunk_2] …

### Guided Passages (kb-suggested filters)
- filter: shastra=samaysaar, gatha=6
  [chunk_g1] …
  [chunk_g2] …
- filter: shastra=samaysaar
  [chunk_g3] …
```

Citation/score handling: guided chunks go through the same chunk-hash and
scoring pipelines as default chunks; the only difference is the labelled
section in the prompt.

## Failure handling

- If `guidedFilters[]` empty → no extra `search` calls; behaviour identical to
  today. **No hard dependency.**
- Each guided `search` call is best-effort: failures are logged and that
  filter's bucket is skipped.

## Code changes

- `src/orchestrator/kb_guided_filters.js`: pure function `deriveGuidedFilters`
  + cap, and `fetchGuidedResults` (fires one filtered `search` per guided
  filter and assembles the `guided_results[]` buckets).
- All five retrieval workflows (`basic_question_v1`, `followup_question_v1`,
  `advanced_distinct_questions_v1`, `advanced_nested_questions_v1`, and the
  Gujarati-mode parallel pair) call both.
- `utils/chunk.js`: extend context builder with the new section.

## Tests

- Pure-function tests for `deriveGuidedFilters` (dedupe, cap, null
  handling).
- `fetchGuidedResults` tests: one search per filter, shastra→granth mapping,
  page_size override, budget exhaustion, per-call failure skip.
- Workflow tests: when merged topics produce N refs, N extra filtered searches
  fire and produce N labelled `guided_results[]` buckets.
- Backward compat: no topics → no guided searches → chat still produces an
  answer.

## DoD

- [x] Separate filtered `search` call per guided filter (when non-empty) — all 4 retrieval workflows call `fetchGuidedResults`.
- [x] New Step2 section rendered when guided chunks exist (`buildGuidedContext` produces `### Guided Passages` section; guided chunks included in scoring and citations).
- [x] Backward-compat path verified by integration test (Phase 9 scenario 5: old agent API → valid answer without guided passages).
- [x] Enhancement contract doc reverted — the agent API is **not** modified; guided retrieval is done chat-side.

## Implementation notes (revised design)

The agent API contract is **unchanged**. Instead of a `guided_filters[]`
request field + `guided_results[]` response bucket, chat now:

1. Runs the default unfiltered `search` call as today (returns a flat array).
2. Fires one **separate** filtered `search` call per derived guided filter
   (`fetchGuidedResults` in
   [`kb_guided_filters.js`](../../src/orchestrator/kb_guided_filters.js)),
   with `page_size=3` (env `KB_GUIDED_PAGE_SIZE`) and `page=1`, and assembles
   the `guided_results[]` buckets itself.

Filter mapping: `shastra` (natural_key) → the agent-search `granth` field —
the only shastra-level filter the existing search API exposes. `gatha`/`page`/
`teeka` have no corresponding agent-search field, so they are carried only in
the returned label (the LLM still sees them in the Step2 "Guided Passages"
section). Each guided call consumes from the workflow tool budget and stops
when the budget is exhausted; per-call failures are logged and skipped.

The previously-added enhancement contract doc
(`cataloguesearch_tools_enhancements.md`) has been **removed** since no agent
API change is required.
