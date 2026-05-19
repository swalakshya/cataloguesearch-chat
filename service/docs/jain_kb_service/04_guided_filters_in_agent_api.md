# Phase 4 (chat) — Guided Filters on the Agent API

Use the merged topics from Phase 3 to derive **guided filters**
(`{shastra, gatha, page}` triples) and pass them to a new field on the
cataloguesearch agent API. The agent API then runs the user query both
unfiltered (current behaviour) and once per guided-filter set, returning a
new `guided_results[]` bucket in the response. Chat passes both buckets to
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
  guided_filters: deriveGuidedFilters(mergedTopics, GUIDED_CAP),   // NEW
  page_size: ...,
  page: 1,
  rerank: true,
})
```

Response shape gains a new field (see enhancement contract doc):

```jsonc
{
  "results": [ /* existing chunks */ ],
  "guided_results": [
    {
      "guided_filter": { "shastra": "samaysaar", "gatha": 6, "page": null, "teeka": null },
      "results": [ /* chunks retrieved under that filter */ ]
    }
  ]
}
```

Chat passes both `results[]` and the flattened `guided_results[].results[]`
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

- If `guided_filters[]` empty → omit the field; agent API behaves exactly
  as today.
- If agent API returns no `guided_results` field (older deployment) → chat
  proceeds with `results[]` only. **No hard dependency.**

## Code changes

- `src/agent_api/client.js`: add `guided_filters` to request schema; tolerate
  missing `guided_results` in response.
- `src/orchestrator/kb_guided_filters.js`: pure function `deriveGuidedFilters`
  + cap.
- All five retrieval workflows (`basic_question_v1`, `followup_question_v1`,
  `advanced_distinct_questions_v1`, `advanced_nested_questions_v1`, and the
  Gujarati-mode parallel pair) call it.
- `utils/chunk.js`: extend context builder with the new section.

## Tests

- Pure-function tests for `deriveGuidedFilters` (dedupe, cap, null
  handling).
- Workflow tests: when merged topics produce N refs, agent API receives
  guided_filters; response merges correctly.
- Backward compat: agent API mock returns no `guided_results` → chat still
  produces an answer.

## DoD

- [ ] `guided_filters` on every `external_search` call (when non-empty).
- [ ] New Step2 section rendered when guided chunks exist.
- [ ] Backward-compat path verified by integration test.
- [ ] Enhancement contract doc updated (see next bullet).

## Linked enhancement contract

This phase requires updating
`service/docs/cataloguesearch/tools/cataloguesearch_tools_enhancements.md`
with:

1. New request field `guided_filters: Array<{shastra?, gatha?, page?, teeka?}>`
   on `POST /api/agent/search`.
2. New response field
   `guided_results: Array<{guided_filter, results: Chunk[]}>`.
3. Backward-compatibility note (both fields optional; default behaviour
   unchanged when absent).
4. Example request / response pair.

Treat that doc as the authoritative contract; this Phase 4 doc owns chat-side
behaviour only.
