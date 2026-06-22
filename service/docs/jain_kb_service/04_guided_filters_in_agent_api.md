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

`deriveGuidedFilters(mergedTopics, cap)` produces `{shastra, gatha, page, teeka}`
filters from each merged topic, sourcing from **two** places (see the
2026-06-22 verse-level note below for why):

1. **Per-extract `extracts_hi[].main_reference`** (verse-level). The live
   `topics_match` response carries the verse number only here — in
   `resolved_fields`, keyed by a **shastra-specific** Hindi identifier
   (`गाथा`/`श्लोक`/`दोहक`/`सूत्र`/`काव्य`, often shastra-prefixed, e.g.
   `तत्त्वार्थसूत्रसूत्र`). The expected token comes from the canonical config's
   `gatha_identifier` (last component for compound ones); the field name is
   prefix-stripped before matching, and `पृष्ठ` is read as `page`.
2. **Topic-level `references[]`** (granth-level fallback). These carry
   `shastra_natural_key`/`page_number`/`teeka_natural_key` but `gatha_number` is
   `null` on live data, so they only contribute a granth-only filter — and that
   is dropped when an extract already supplied a verse for the same shastra.

Refs are then deduped (by JSON key) and capped. Cap default:
`KB_GUIDED_FILTERS_CAP=5` (env-tunable).

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

Filter mapping: `shastra` (a **Hindi** `natural_key`) → the agent-search
`granth` field, which expects the **english_name**. The Hindi→English mapping
comes from
[`shastra_canonical_translated_naming.js`](../../src/config/shastra_canonical_translated_naming.js)
(`resolveGranthFilters`). A single Hindi name can map to **multiple** english_names
(e.g. `समयसार` → `Samaysaar` **and** `Samaysaar Kalash Tika`), so
`fetchGuidedResults` fires **one agent API `search` call per matching
english_name** and returns a separate bucket per call (each carrying the
resolved `granth`). Unmapped Hindi values fall back to the raw string so at
least one query still runs.

**Verse-level filter (new).** The agent search API now also accepts verse
filters — `gatha`, `shlok`, `doha`, `kavya`, `sutra` (each maps to the backend
`chunk_labels.*` keyword field). For each resolved canonical-naming entry where
`includes_adhikaar` is **not** `true`, `resolveGranthFilters` derives the
matching verse field from the single-component `gatha_identifier`
(`गाथा→gatha`, `श्लोक→shlok`, `दोहक/दोहा→doha`, `काव्य→kavya`, `सूत्र→sutra`);
when the entry has **no** `gatha_identifier` the field defaults to `gatha`.
When such a field exists and the guided filter carries a `gatha` number, that
number is passed as the verse filter alongside `granth` for a tighter
retrieval. Adhikaar-scoped shastras (where a bare verse number is ambiguous
across chapters), entries with a multi-component identifier (e.g.
`अधिकार,श्लोक`), and unmapped tokens (e.g. `प्रश्न`) get **no** verse filter —
`gatha` is then carried only in the label.

`page`/`teeka` have no corresponding agent-search field, so they are carried
only in the returned label (the LLM still sees them in the Step2 "Guided
Passages" section, alongside the resolved `granth=`). Each guided call consumes
from the workflow tool budget and stops when the budget is exhausted; per-call
failures are logged and skipped.

The previously-added enhancement contract doc
(`cataloguesearch_tools_enhancements.md`) has been **removed** since no agent
API change is required.

## Implementation notes (2026-06-22) — verse number sourced from extracts

Live debugging showed guided searches were firing **granth-only, with no
`gatha`**, for verse-relevant queries. Root cause: `deriveGuidedFilters` read
the verse from the topic-level `references[]`, but on the live `topics_match`
response that array's `gatha_number` is always `null` — it is a coarse,
topic-level shastra list. The actual verse lives **per extract** in
`extracts_hi[].main_reference.resolved_fields`, e.g.
`{shastra_name: "मोक्ष पाहुड़", resolved_fields: [{field: "गाथा", value: 4}]}`.

Fix (in [`kb_guided_filters.js`](../../src/orchestrator/kb_guided_filters.js)):

- `refFromMainReference()` normalizes an extract's `main_reference` into
  `{shastra, gatha, page, teeka}`. The verse is **not always `गाथा`** — the
  identifier is shastra-specific. The token to look for is derived from the
  canonical config's `gatha_identifier` (`HINDI_TO_VERSE_TOKEN`: last component
  of compound identifiers like `अधिकार,श्लोक` → `श्लोक`; default `गाथा` when
  absent). Field names are prefix-stripped (`stripSourcePrefix`, mirroring
  `kb_topic_match`) so `तत्त्वार्थसूत्रसूत्र` → `सूत्र` matches. Shastras absent
  from the config fall back to matching any known verse identifier.
- `refsForTopic()` merges per-extract verse refs with the topic-level
  `references[]` fallback and drops a granth-only ref when a verse-bearing ref
  already exists for the same shastra (avoids a redundant granth-only search).
- The downstream verse-field gate (`verseFieldForEntry`/`resolveGranthFilters`)
  is unchanged: it still decides **which** agent-search field to set and
  suppresses verse filtering for adhikaar-scoped/compound shastras, so the
  number is carried only in the label there.

Several canonical entries gained `gatha_identifier`/`includes_adhikaar` so their
verse token resolves correctly (e.g. `इष्टोपदेश→श्लोक`, `ज्ञानार्णव→अधिकार,दोहक`,
`तत्त्वार्थसूत्र→अध्याय,सूत्र`).
