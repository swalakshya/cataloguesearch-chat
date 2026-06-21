# Phase 1 — Implementation Notes

## Implemented

### Files changed

| File | Change |
|------|--------|
| `src/config/keyword_schema.js` | Added `jain_keywords`, `normal_keywords`, `kb_subworkflows`, `kb_entities` to both `KEYWORD_EXTRACTION_SCHEMA` and `KEYWORD_EXTRACTION_SCHEMA_GUJ_SEARCH`. All four fields follow the existing nullable-required pattern for OpenAI strict mode. |
| `src/orchestrator/keyword_extract.js` | Added `applyJainPartitionDefaults()` (Devanagari fallback) and `stripUnknownSubworkflows()` post-processing after `parseJsonStrict`. Both helpers are module-level, pure, and log via `log.warn` when sub-workflows are stripped. |
| `prompts_sets/prompts_v2/step_1_keyword_extract_and_classification.md` | Added rules 8–10 (Jain classification, KB entities, KB sub-workflows), a full KB Sub-workflow Catalog section with one few-shot example per sub-workflow, and new fields in OUTPUT JSON. |
| `prompts_sets/prompts_v2_gemini-2_5-flash/step_1_*` | Same additions as `prompts_v2/`. |
| `prompts_sets/prompts_v2_gemini-3-flash-preview/step_1_*` | Same additions as `prompts_v2/`. |
| `prompts_sets/prompts_v2_gpt-4o/step_1_*` | Same KB catalog + output fields added to the existing concise format for GPT-4o. |
| `test/config/keyword_schema.test.js` | 6 new tests covering all new schema fields, enum values, required membership, and guj-search parity. |
| `test/orchestrator/keyword_extract.test.js` | 8 new tests: Devanagari partition (missing, present, all-Devanagari, all-latin), sub-workflow stripping, null sub-workflows, and prompt snapshot for new section markers. |

### Schema design decisions

- `kb_subworkflows.items` uses a single merged schema with all possible fields declared as nullable and `additionalProperties: false`. This satisfies OpenAI strict mode now; Phase 6 can narrow per-name requirements or switch to `anyOf` if validation strictness is needed.
- `kb_entities` uses the same nullable-required pattern (`shastra_hints: ["array","null"]`, `author_hints: ["array","null"]`).
- All four new fields are in `required[]` as nullable to maintain strict-mode compatibility across both schemas.

### Devanagari detection

Uses Unicode range `/[ऀ-ॿ]/` (U+0900–U+097F), which covers Devanagari proper including extended range used by Hindi, Sanskrit, and Prakrit. Covers the practical range of Jain keywords expected from the LLM.

### Backward compatibility

The new fields are all nullable. If an existing LLM response (or any model not yet updated) omits `jain_keywords`/`normal_keywords`, the orchestrator derives them automatically from `keywords[]` via Devanagari detection. If `kb_subworkflows` is absent, post-processing is a no-op. No downstream code consumes the new fields yet (Phases 2–7 will).

## Diversions from spec

- The spec says to edit only `prompts_v2/`; we also updated the three model-specific folders since they take precedence in the resolution chain and would otherwise shadow the new content.
- `kb_subworkflows` uses one merged schema item rather than per-name schemas (deferred to Phase 6 per spec note).

---

# Phase 2 — Implementation Notes

## Implemented

### Files changed

| File | Change |
|------|--------|
| `src/kb_api/client.js` | New `KbApiClient` class following same patterns as `ExternalApiClient`. One public method: `keywordResolveBatch(tokens, opts, requestId)` → POST `/v1/query/keyword_resolve_batch`. AbortController timeout, structured logging (`kb_api_request`, `kb_api_response`, `kb_api_failed`, `kb_api_parse_failed`). |
| `src/orchestrator/kb_keyword_check.js` | New module. `runKbKeywordCheck()` owns: resolve batch call → matched/missed split → canonical rewrite of `keywords[]`+`jain_keywords[]` → Step1b gate (fires only when missed has suggestions). Adds `kb_canonical_map` to result. Degrades gracefully (returns original on KB failure). |
| `src/orchestrator/keyword_fix.js` | Added `missedWithSuggestions` param; threads it to `getKeywordFixPrompt`. |
| `src/orchestrator/prompts.js` | `getKeywordFixPrompt` now renders `<MISSED_JAIN_KEYWORDS_WITH_SUGGESTIONS>` via `renderMissedSuggestionsSection()`. When no suggestions provided, renders `(none)` — keeping the template slot always replaced for both the zero-chunks path and the kb-driven path. |
| `prompts_sets/prompts_v2/step_1b_keyword_fix.md` | Added `## Missed Jain Keywords with Dictionary Suggestions` section with `<MISSED_JAIN_KEYWORDS_WITH_SUGGESTIONS>` placeholder and instructions. |
| `prompts_sets/prompts_v2_gemini-2_5-flash/step_1b_*` | Same additions. |
| `prompts_sets/prompts_v2_gemini-3-flash-preview/step_1b_*` | Same additions. |
| `prompts_sets/prompts_v2_gpt-4o/step_1b_*` | Same additions. |
| `src/server.js` | Imports `KbApiClient` + `runKbKeywordCheck`. Reads `KB_ENHANCE_ENABLED`, `KB_SERVICE_BASE_URL`, `KB_REQUEST_TIMEOUT_SEC` from env/options. Creates `kbApiClient` when enabled. Inserts `runKbKeywordCheck` call after greeting short-circuit, before `retryWorkflowOnEmptyChunks`. Logs `kbEnhanceEnabled` at `service_start`. |
| `test/orchestrator/kb_keyword_check.test.js` | 11 new tests: matched-only, exact same key, miss+suggestions fires Step1b, miss-no-suggestions skips Step1b, no jain_keywords skips KB call, KB failure graceful, canonical rewrite correctness, kb_canonical_map preserved through Step1b, plus 3 integration-style scenarios (A/B/C). |
| `test/orchestrator/keyword_fix.test.js` | 2 new tests: missedWithSuggestions renders in prompt, absent suggestions renders `(none)`. |

### Architecture decisions

- **`KbApiClient` is a class** matching `ExternalApiClient` style. No shared base class — follows the existing copy-and-adapt pattern.
- **Graceful degradation**: any HTTP error from KB service → log warn → return original `step1Result`. The chat pipeline is never blocked by KB unavailability.
- **`kb_canonical_map` is runtime-only** — not added to the LLM schema, only on the orchestrator's in-memory `keywordResult` object. Phase 7 will read it from there.
- **Step1b trigger gate**: fires only when `missed.length > 0 AND missedWithSuggestions.length > 0`. If all misses have empty suggestions, falls through to the existing zero-chunks-triggered Step1b unchanged.
- **Both Step1b paths share the same prompt file** — the `<MISSED_JAIN_KEYWORDS_WITH_SUGGESTIONS>` placeholder renders `(none)` for the zero-chunks path, giving the LLM a consistent template.
- **`KB_ENHANCE_ENABLED=false`** (default) — `kbApiClient` is `null`, `runKbKeywordCheck` is never called, pipeline identical to today.

### Phase 7 note

`kb_canonical_map` is stored on the `keywordResult` object so Phase 7 can look up which original tokens were rewritten when fetching definitions. Keys are original user tokens; values are canonical KB natural keys.

---

# Phase 3 — Topic Match + Extract Injection (Sequential Anchor → Expand)

## Implemented

### Files changed

| File | Change |
|------|--------|
| `src/kb_api/client.js` | Added `topicsMatch({ keywords, limit, includeExtracts, includeReferences }, requestId)` → POST `/v1/query/topics_match`; returns `parsed.matches` array. Added `graphrag({ tokens, limit, includeExtracts, includeNeighbors, includeReferences }, requestId)` → POST `/v1/query/graphrag`; returns `parsed.ranked_topics` array. Added `topicNeighbors({ topicNaturalKeys, maxNeighborsPerTopic, includeExtracts, includeReferences }, requestId)` → POST `/v1/query/topic_neighbors`; returns `parsed.neighbors_by_anchor` as an object map (keyed by `topic_natural_key`), falling back to `{}`. |
| `src/config/kb_config.js` | Added `topic_neighbors_limit` cap (`KB_TOPIC_NEIGHBORS_LIMIT`, default 10) to `KB_CAPS_DEFAULTS`. |
| `src/orchestrator/kb_topic_match.js` | New module. Exports `extractKeywordSets(keywordResult)`, `runKbTopicMatch({ keywordResult, kbApiClient, requestId })`, `attachNeighbors(anchors, neighborsByAnchor)`, `formatKbTopicsContext(mergedTopics)`. Per keyword set, runs two sequential stages: stage 1 `topicsMatch` (anchor), then stage 2 `topicNeighbors` (expand) — fired only when anchors are returned. `graphrag` not used. `runKbTopicMatch` deduplicates anchors across keyword sets (highest score wins), calls `attachNeighbors`, sorts by score DESC, slices to `KB_TOPIC_MERGE_LIMIT`. `formatKbTopicsContext` renders an optional `  related: <comma-joined display names>` line per topic when `topic.neighbors.related_topics` is non-empty. |
| `src/server.js` | Imports `runKbTopicMatch` + `formatKbTopicsContext`. Starts `topicMatchPromise` immediately after `runKbKeywordCheck` (parallel with workflow). Awaits the promise after `retryWorkflowOnEmptyChunks`. Prepends formatted KB topics section to context string before passing to `runAnswerSynthesis`. |
| `test/orchestrator/kb_topic_match.test.js` | 36 tests: `attachNeighbors` unit tests (with/without match, unknown key ignored, null/array input), `extractKeywordSets` for all workflow types, `formatKbTopicsContext` (header, path, extract, refs, null fields, `related:` line), and `runKbTopicMatch` asserting 1 `topicsMatch` + 1 `topicNeighbors` per keyword set, 0 graphrag calls, sequential key delivery, skip-expand when anchors empty, stage-1 failure → `[]`, stage-2 failure → bare anchors, cross-set deduplication, and merge cap enforcement. |

### Architecture decisions

- **Sequential within a set, parallel across sets**: `topicNeighbors` depends on `topicsMatch` output (needs the natural keys), so the two calls within each keyword set are sequential. All keyword sets still run concurrently via `Promise.all`. Net call count: `n_sets × 2` (same as the original parallel design, different dependency order).
- **`graphrag` removed from this path**: the `graphrag` method remains in `KbApiClient` for any other potential callers but is not invoked by `runKbTopicMatch`. `KB_GRAPHRAG_LIMIT` env var remains in `KB_CAPS_DEFAULTS` for backward compatibility.
- **`attachNeighbors` instead of `mergeTopicResults`**: `mergeTopicResults` unioned two sources (topics_match + graphrag) on the same key. With a single source, deduplication only applies across multiple keyword sets. `attachNeighbors` is a pure function that joins stage-2 neighbor output onto existing anchors by `topic_natural_key`.
- **Stage-2 failure is best-effort**: if `topicNeighbors` throws, anchors are returned without `neighbors` and the `related:` line is omitted. Downstream consumers (Phase 4 references, Phase 7 seed keywords) are unaffected as they read fields from stage-1 anchors.
- **`neighbors_by_anchor` return shape**: the KB endpoint returns `{ neighbors_by_anchor: { "<natural_key>": { related_topics, related_keywords, mentioned_in_gathas }, ... } }`. The client returns the inner object map directly (defaulting to `{}`), unlike the array-unwrapping done by `topicsMatch`/`graphrag`.
- **Context injection**: `formatKbTopicsContext` produces a `### KB Topics` markdown section prepended to the chunks context. No prompt template files need changing. Skipped for `metadata_question_v1`.
- **Graceful degradation**: stage-1 failure returns `[]` for that keyword set (no expand attempted). Stage-2 failure returns bare anchors. If all sets fail, `mergedTopics` is `[]` and no KB section is injected.
- **Caps**: `KB_TOPIC_MATCH_LIMIT` (default 5), `KB_TOPIC_NEIGHBORS_LIMIT` (default 10), `KB_TOPIC_MERGE_LIMIT` (default 5) read from env at call time.
- **`KB_ENHANCE_ENABLED=false`** (default): `kbApiClient` is `null`, `topicMatchPromise` resolves to `[]` immediately, pipeline unchanged.

### Response envelope unwrapping

The kb API wraps results:
- `/v1/query/topics_match` → `{ matches: [...], tool_trace_id }` — client returns `matches`
- `/v1/query/graphrag` → `{ ranked_topics: [...], unresolved_tokens: [], tool_trace_id }` — client returns `ranked_topics`
- `/v1/query/topic_neighbors` → `{ neighbors_by_anchor: { ... }, tool_trace_id }` — client returns `neighbors_by_anchor` object map

### Deviations from spec

- **Only first extract rendered per topic**: `formatKbTopicsContext` renders only `extracts_hi[0]` per topic to keep context compact. All extracts remain on the merged object for downstream phases.
- **Cross-set deduplication by highest score**: the spec's assembly loop does not address the same topic appearing from multiple keyword sets. The implementation deduplicates by `topic_natural_key` keeping the highest score, consistent with the `KB_TOPIC_MERGE_LIMIT` cap intent.
- **`mergeTopicResults` removed from exports**: tests were rewritten to test `attachNeighbors` instead. No external callers of `mergeTopicResults` existed outside the test file.

---

# Phase 4 — Guided Filters in Agent API

> **Revision (no agent-API change):** The original implementation passed a
> `guided_filters[]` field to a single `search` call and read a `guided_results[]`
> envelope back, requiring an agent-API contract change. That has been reverted.
> The agent API is now **unchanged**: `ExternalApiClient.search()` returns the raw
> flat chunk array again, and guided retrieval is done chat-side by firing one
> **separate** filtered `search` call per guided filter
> (`fetchGuidedResults` in `kb_guided_filters.js`, `page_size=3` via
> `KB_GUIDED_PAGE_SIZE`, `shastra`→`granth` mapping). The
> `cataloguesearch_tools_enhancements.md` contract doc was removed. The notes
> below describe the original (now-superseded) approach for `client.js`,
> `normalizeSearchResponse`, and the `guided_filters` payload field.

## Implemented

### Files changed

| File | Change |
|------|--------|
| `src/orchestrator/kb_guided_filters.js` | New pure function `deriveGuidedFilters(mergedTopics, cap)`. Iterates topics' `references[]`, maps each to `{shastra, gatha, page, teeka}`, deduplicates by JSON key, caps at `KB_GUIDED_FILTERS_CAP` env (default 5). Guard at cap≤0 returns empty. |
| `src/agent_api/client.js` | `search()` now wraps `#post` result through `normalizeSearchResponse()`: flat array → `{ results: array, guided_results: [] }`; envelope `{ results, guided_results }` → pass-through; empty → `{ results: [], guided_results: [] }`. Passes `guided_filters` through unchanged in request body. |
| `src/orchestrator/workflows/basic_question_v1.js` | Reads `params.mergedTopics`, calls `deriveGuidedFilters`. Passes `guided_filters` in search payload (omitted when empty). Returns `{ chunks, guidedResults }` instead of flat array. `safeFetch` updated to return `{ results, guided_results }`. |
| `src/orchestrator/workflows/followup_question_v1.js` | Same guided_filters integration. Accumulates `guidedResults` across all `searchPair` calls. Navigate calls use separate `safeFetchArray` returning plain array. Returns `{ chunks, guidedResults }`. |
| `src/orchestrator/workflows/advanced_distinct_questions_v1.js` | Same. `safePush` now also accumulates `allGuidedResults`. Returns `{ chunks, guidedResults }`. |
| `src/orchestrator/workflows/advanced_nested_questions_v1.js` | Same. All search calls (main + sub) collect guided_results. Returns `{ chunks, guidedResults }`. |
| `src/orchestrator/workflow_router.js` | Accepts `mergedTopics` param, passes to `params.mergedTopics`. Runner result normalized: flat array (metadata) → `{ chunks, guidedResults: [] }`; object → destructured. Logs `guidedResultSets`. Returns `{ workflowName, chunks, guidedResults, toolCallsUsed }`. |
| `src/orchestrator/keyword_fix_retry.js` | Accepts `mergedTopics` param, passes to both `runWorkflowFn` calls (both retry attempts use same topics). |
| `src/utils/chunk.js` | New `buildGuidedContext(guidedResults)` and private `formatGuidedFilter(f)`. Produces `### Guided Passages (kb-suggested filters)` section with per-filter labelled sub-sections. |
| `src/server.js` | Phase 3 `topicMatchPromise` is now awaited synchronously before workflow (no longer parallel). `mergedTopics` threaded to `retryWorkflowOnEmptyChunks`. Destructures `guidedResults` from workflowOutcome. Cleans/hashes guided chunks per filter set; adds `hashedGuidedFlat` to `allHashedChunks` for scoring/citations; builds `guidedSection` via `buildGuidedContext`; context assembled as `[kbTopicsSection, chunksContext, guidedSection].filter(Boolean).join('\n\n')`. `metadataByRealId` built from raw chunks + guided raw chunks. |
| `src/testing/test_external_api.js` | `search()` stub updated to return `{ results: [...], guided_results: [] }` to match new client contract. |
| `test/orchestrator/kb_guided_filters.test.js` | 13 new tests covering: empty inputs, null-only refs, cap enforcement, env-var cap, dedup within and across topics, field mapping, partial refs, cap=0. |
| `test/agent_api/client.test.js` | 5 new tests: flat-array normalization, envelope normalization, empty-response normalization, guided_filters pass-through, missing guided_results field. 3 existing tests retained. |
| `test/orchestrator/workflows/basic.test.js` | All 5 original tests updated (search mocks now return `{ results, guided_results }`). 4 new Phase 4 tests: guided_filters in payload, omit when empty, collect guided_results, backward compat. |
| `test/orchestrator/workflows/followup.test.js` | All 6 original tests updated. 3 new Phase 4 tests: return shape, guided_filters in payload, accumulate from multiple calls. |
| `test/orchestrator/workflows/advanced_distinct.test.js` | All 2 original tests updated. 3 new Phase 4 tests. |
| `test/orchestrator/workflows/advanced_nested.test.js` | All 3 original tests updated. 3 new Phase 4 tests. |
| `test/utils/chunk_utils.test.js` | 7 new tests for `buildGuidedContext`. |
| `test/orchestrator/workflow_router.test.js` | All search mocks updated to return `{ results: [], guided_results: [] }`. |

### Architecture decisions

- **topicMatch now sequential before workflow**: Phase 3 ran `topicMatchPromise` in parallel with the external search workflow. Phase 4 must have `mergedTopics` available before any search call, so `server.js` now awaits the promise before calling `retryWorkflowOnEmptyChunks`. This is intentional: the guided_filters benefit from KB topics, and the latency cost is accepted.
- **`search()` return type change**: `ExternalApiClient.search()` now always returns `{ results, guided_results }`. All callers (the 4 retrieval workflow files + test mocks) were updated. No other code calls `search()` directly.
- **Backward compat**: `normalizeSearchResponse` handles the current flat-array API response transparently. When the agent API is upgraded to return the envelope, the client automatically uses `guided_results`.
- **`guidedResults` in `allHashedChunks`**: Guided chunks are added to `allHashedChunks` so the LLM's citation references (`[c1]`, etc.) resolve correctly and guided chunks appear in scored references. The per-filter labelled context section lets the LLM distinguish them.
- **metadata_question_v1 unaffected**: workflow_router normalizes its flat array return; server skips guided section for metadata workflow.

### Deviations from spec

- **`cap=0` guard added**: `deriveGuidedFilters` returns `[]` immediately when `effectiveCap ≤ 0`. The spec code would push one item before returning; the guard is semantically correct (cap=0 means "no guided filters").
- **`metadataByRealId` includes guided chunks**: The spec doesn't explicitly mention this, but it's necessary for guided chunk citations to resolve through `buildChunkCitationMap`.

---

# Phase 5 — Metadata Enhancement (parallel kb + cataloguesearch)

## Implemented

### Files changed

| File | Change |
|------|--------|
| `src/kb_api/client.js` | Added `shastras({q, fuzzy, limit})`, `authors({…})`, `teekas({…})` GET methods. Added private `#get(path, requestId, base)` helper following same AbortController/logging pattern as `#post`. Endpoints: `GET /v1/shastras`, `GET /v1/authors`, `GET /v1/teekas` on `coreBaseUrl` with query params `q`, `fuzzy`, `limit`. (**Note**: original implementation used `/v1/metadata/*` prefix and the single `baseUrl`; corrected when metadata/data/navigation were merged into core-service.) |
| `src/orchestrator/kb_metadata_match.js` | New module. `fetchKbMetadataMatches(kbApiClient, kbEntities, requestId)` fires parallel calls per hint (per-hint error catch so one timeout never blocks the rest), flattens results, deduplicates by `natural_key`. Returns `null` when no hints present. `buildKbMetadataSection(kbMatches)` formats `### KB Metadata Matches (closest first)` with `- shastra: name (nk=..., sim=...)` lines; returns `""` when no matches (omits empty heading per spec). |
| `src/orchestrator/workflows/metadata_question_v1.js` | Accepts `kbApiClient` as a separate top-level parameter. Starts `kbMatchesPromise` (with catch for non-critical failures) before the `getMetadataOptions` loop to achieve parallel execution. Awaits the promise after all `getMetadataOptions` calls complete. Returns `{ chunks: [...], kbMetadataSection }` object instead of flat array. |
| `src/orchestrator/workflow_router.js` | Accepts `kbApiClient = null` parameter. Passes `kbApiClient` to runner via top-level destructured parameter. Extracts `kbMetadataSection` from runner result (`""` for flat-array legacy returns). Returns `kbMetadataSection` in result object. |
| `src/orchestrator/keyword_fix_retry.js` | Accepts `kbApiClient = null` parameter. Passes through to both `runWorkflowFn` calls (first attempt and keyword-fix retry). |
| `src/server.js` | Imports `fetchKbMetadataMatches`, `buildKbMetadataSection` from `kb_metadata_match.js`. For non-metadata workflows: starts `kbMetadataPromise` before `retryWorkflowOnEmptyChunks` (parallel execution). Passes `kbApiClient` to `retryWorkflowOnEmptyChunks`. After workflow completes: resolves `kbMetadataSection` from `workflowOutcome.kbMetadataSection` (metadata workflow) or from awaited `kbMetadataPromise` (non-metadata). Prepends `kbMetadataSection` to context assembly. Logs `kbMetadataSectionPresent` in `kb_topic_match_injected` log line. |
| `test/kb_api/client.test.js` | New file. 7 tests covering `shastras` (URL/params, header, empty body, error), `authors`, `teekas`, and default param values. |
| `test/orchestrator/kb_metadata_match.test.js` | New file. 14 tests: `buildKbMetadataSection` (null, empty, shastra, author, both, no-sim), `fetchKbMetadataMatches` (null client, null entities, no hints, shastras call, authors call, multiple hints parallel, dedup, timeout degrades, partial failure degrades). |
| `test/orchestrator/workflows/metadata_question_v1.test.js` | New file. 8 tests: return shape, no kbApiClient, shastra_hint both lists present, no call when hints absent, no call when kb_entities null, kb timeout workflow succeeds, empty match omits section, parallel execution timing. |

### Architecture decisions

- **`kbApiClient` as top-level workflow parameter**: rather than piggy-backing on `params`, `kbApiClient` is passed as a named top-level argument to runner functions. Other workflow runners (basic, followup, etc.) accept but ignore it, keeping their signatures forward-compatible.
- **Non-metadata workflows**: kb metadata calls start in `server.js` before `retryWorkflowOnEmptyChunks`. Since the workflow involves LLM + external search (much slower), the kb calls complete before the workflow finishes — effectively parallel. No changes to the 4 retrieval workflow files.
- **Metadata workflow**: fires kb calls inside `runMetadataQuestion` in parallel with the `getMetadataOptions` loop (spec requirement). Returns `{ chunks, kbMetadataSection }` instead of flat array; `workflow_router.js` normalizes this.
- **Return type change for metadata workflow**: previously `[{ kind: "metadata", ... }]` (flat array); now `{ chunks: [...], kbMetadataSection }`. `workflow_router.js` already handles both flat-array and object shapes, so no downstream breakage. All other callers (routing, retry) spread the result — the new `kbMetadataSection` field is additive.
- **Context ordering**: `kbMetadataSection` is prepended first, then `kbTopicsSection`, then `chunksContext`, then `guidedSection`. For metadata workflow this means KB matches appear before the CatalogueSearch metadata JSON, matching the spec's "labelled side-by-side" intent.
- **Graceful degradation**: every kb call is wrapped in `.catch()` at three levels: per-hint catch in `fetchKbMetadataMatches`, outer catch in `metadata_question_v1.js`, and outer catch for the pipeline-level promise in `server.js`.
- **`teekas` method added to client**: spec lists it alongside shastras/authors. Not yet called in Phase 5 (no `teeka_hints` in `kb_entities`), but wired and tested for future use.
- **`KB_ENHANCE_ENABLED=false`**: `kbApiClient` is `null`, `fetchKbMetadataMatches` returns `null` immediately, `buildKbMetadataSection(null)` returns `""`, context identical to pre-Phase-5.

### Deviations from spec

- **`teekas` not called in metadata workflow**: `kb_entities` schema only has `shastra_hints` and `author_hints`; there is no `teeka_hints` field. The `teekas` client method is implemented and tested but not yet wired into `fetchKbMetadataMatches` pending Phase 6/schema extension.
- **No `### CatalogueSearch Metadata Options` wrapper label**: the spec shows this label on the cataloguesearch section. The existing `buildContext` renders metadata options as `Source N: { ... }` JSON. Adding a label would require changing `buildContext` or splitting the metadata workflow context assembly. Deferred: the LLM still receives both sections clearly separated and can reconcile them from structure alone.

---

# Phase 6 — KB Sub-workflow Dispatch

## Implemented

### Files changed

| File | Change |
|------|--------|
| `src/kb_api/client.js` | Added `gathaDetail({ shastra, number })` → `GET /v1/gathas?shastra=&number=` on `coreBaseUrl` (core-service, port 8001). Added `topicsInShastra({ shastra, gathaNumber, limit })` → `POST /v1/query/topics_in_shastra` with JSON body `{ shastra_natural_key, gatha_number?, limit }`; returns `parsed.topics` array. Added `shastrasForTopic({ topicNaturalKey, limitShastras, limitGathasPerShastra })` → `POST /v1/query/shastras_for_topic` with JSON body `{ topic_natural_key, limit_shastras, limit_gathas_per_shastra }`; returns `parsed.shastras` array. (**Note**: original implementation had all three as GET with query-string params and used `baseUrl`; corrected — `topicsInShastra`/`shastrasForTopic` are POST endpoints in query-service, `gathaDetail` routes to core-service.) |
| `src/orchestrator/kb_subworkflows.js` | New module. Exports `runKbSubworkflows(kbSubworkflows, kbApiClient, requestId)` and `formatKbSubworkflowsContext(results)`. Dispatch table maps sub-workflow names to handlers. `runKbSubworkflows` caps entries at `KB_SUBWORKFLOWS_MAX` (default 4), races each dispatch against a per-entry `KB_SUBWORKFLOW_TIMEOUT_MS` (default 10000ms) timeout, logs warn on failure/timeout, and returns only successful non-null results. Each dispatcher: canonicalizes shastra via `kb.shastras(fuzzy)`, then calls the appropriate data/query endpoint. `search_shastra_for_topics` does an optional `topicsMatch` to resolve a natural key from the `topic` field before calling `shastrasForTopic`. |
| `src/server.js` | Imports `runKbSubworkflows` and `formatKbSubworkflowsContext`. Starts `kbSubworkflowsPromise` in parallel with `kbMetadataPromise` (before `retryWorkflowOnEmptyChunks`) when `kbApiClient` is set, workflow is not metadata, and `kb_subworkflows` array is non-empty. Awaits the promise after the workflow completes. Adds `kbSubworkflowsSection` to the context assembly between `kbTopicsSection` and `chunksContext`. Logs `kbSubworkflowsCount` in `kb_topic_match_injected` log line. |
| `prompts_sets/prompts_v2/workflow_answering_guidelines/basic_question.md` | Added `## KB Sub-workflow Results` section describing how to use direct_retrieval, search_topic_in_shastra, and search_shastra_for_topics sub-workflow entries. |
| `prompts_sets/prompts_v2/workflow_answering_guidelines/followup_question.md` | Same addition. |
| `prompts_sets/prompts_v2/workflow_answering_guidelines/advanced_distinct_questions.md` | Same addition. |
| `prompts_sets/prompts_v2/workflow_answering_guidelines/advanced_nested_questions.md` | Same addition. |
| `test/kb_api/client.test.js` | 8 new tests covering `gathaDetail` (URL/params, header, 404), `topicsInShastra` (URL/params, null gatha_number, default limit), `shastrasForTopic` (URL/params, default limits). |
| `test/orchestrator/kb_subworkflows.test.js` | New file. 26 tests covering `formatKbSubworkflowsContext` (empty, each sub-workflow type, ordering, null mention_count) and `runKbSubworkflows` (null guards, direct_retrieval canonicalize/project/default-want/invalid-entries, search_topic_in_shastra, search_shastra_for_topics with topicsMatch fallback, cap enforcement, timeout, error resilience, parallel execution, unknown name filtering). |

### Architecture decisions

- **Parallel with metadata**: `kbSubworkflowsPromise` starts at the same time as `kbMetadataPromise` — both run in parallel with the main external search workflow. Since LLM + external search takes much longer, both KB sidecars typically complete before the workflow finishes.
- **Metadata workflow excluded**: sub-workflows are skipped for `metadata_question_v1` (same as other KB phases).
- **`topic` field used for `search_shastra_for_topics`**: The actual `KB_SUBWORKFLOW_ITEM_PROP` schema uses a single `topic` field (not `topic_keywords`/`topic_natural_key` as in the spec). The dispatcher treats `topic` as a potential natural key and attempts `topicsMatch` resolution; if that returns nothing, `topic` is used verbatim. This is forward-compatible if the schema adds separate fields later.
- **Core-service endpoints on `KB_CORE_SERVICE_BASE_URL`**: `shastras`, `authors`, `teekas`, and `gathaDetail` all use `coreBaseUrl` (pointing at the merged core-service on port 8001). The spec originally described `gathaDetail` as a "data-service" endpoint, but after the metadata/data/navigation merge it lives in core-service alongside the other resource endpoints.
- **Env var cleanup in tests**: Tests that modify `process.env.*` use `delete process.env[key]` when `originalValue === undefined` to prevent the string `"undefined"` from polluting subsequent tests (which would cause `Number("undefined") = NaN` and `setTimeout(fn, NaN)` = `setTimeout(fn, 0)`, immediately firing all timeouts).
- **Context ordering**: `[kbMetadataSection, kbTopicsSection, kbSubworkflowsSection, chunksContext, guidedSection]` — sub-workflow results appear after KB topic extracts and before main chunks.

### Deviations from spec

- **Single `topic` field instead of `topic_keywords`/`topic_natural_key`**: The actual schema already merged these into one `topic` field in Phase 1. The dispatcher handles both interpretations gracefully via a topicsMatch resolution step.
- **Endpoint paths verified**: `gathaDetail` → `GET /v1/gathas` on core-service. `topicsInShastra` → `POST /v1/query/topics_in_shastra` and `shastrasForTopic` → `POST /v1/query/shastras_for_topic` on query-service. Paths confirmed against the actual router files in `dictionary-and-metadata-service`.
- **Guideline files only added to `prompts_v2/`**: The spec mentions updating guideline files. Since model-specific guideline files don't currently exist (only `prompts_v2/` has them), updates were applied only to `prompts_v2/`. If model-specific guideline files are added in the future, they would need this content too.

---

# Phase 7 — Jain Keyword Definitions in Step2 Context

## Implemented

### Files changed

| File | Change |
|------|--------|
| `src/kb_api/client.js` | Added `definitionsPerKeyword = 0` option to `keywordResolveBatch`. Passes as `definitions_per_keyword` in POST body. Backward-compatible: existing callers (Phase 2) pass no value and get 0 (all definitions). |
| `src/orchestrator/kb_definitions.js` | New module. Exports `collectUsedJainKeywords(keywordResult, mergedTopics)`, `fetchKbDefinitions({ usedJainKeywords, kbApiClient, requestId })`, `formatKbDefinitionsContext(resolvedKeywords)`. |
| `src/server.js` | Imports `collectUsedJainKeywords` + `fetchKbDefinitions`. After `mergedTopics` is resolved, starts `kbDefinitionsPromise` (parallel with retrieval workflow). Awaits and injects `kbDefinitionsSection` between `kbMetadataSection` and `kbTopicsSection` in context assembly. Logs `kbDefinitionsSectionPresent` in `kb_topic_match_injected`. |
| `test/orchestrator/kb_definitions.test.js` | New file. 24 tests (see below). |

### Test coverage (24 tests)

- `collectUsedJainKeywords`: 8 tests — basic union, seed keywords from topics, dedup, cap from env, empty inputs, null inputs, missing `matched_seed_keywords`, default cap of 15.
- `formatKbDefinitionsContext`: 8 tests — empty/null input, items with no definitions, header+entry format, multiple numbered defs, multiple keywords, empty `text_hi` skipped, `text` fallback field.
- `fetchKbDefinitions`: 8 tests — empty/null tokens no KB call, `fuzzyTopK=0`+`includeDefinitions=true` verified, tokens passed correctly, formatted output, empty resolve, KB throws graceful, `KB_DEFINITIONS_PER_KEYWORD` env var respected.

### Architecture decisions

- **Single batched call**: one `keywordResolveBatch` call per request with `fuzzy_top_k: 0` (no suggestions needed — Phase 2 already resolved these). Per-keyword fan-out explicitly avoided.
- **Parallel with retrieval workflow**: `kbDefinitionsPromise` starts immediately after `mergedTopics` is resolved (which is already sequential before the workflow). The workflow + external search runs concurrently; the cheap batch resolve finishes before the workflow in practice.
- **Context ordering**: `[kbMetadataSection, kbDefinitionsSection, kbTopicsSection, kbSubworkflowsSection, chunksContext, guidedSection]` — definitions appear above topic extracts as specified.
- **Metadata workflow excluded**: `kbDefinitionsSection` is `""` for `metadata_question_v1`, consistent with all other KB phases.
- **Graceful degradation**: any error in `fetchKbDefinitions` logs a warn and returns `""`. The outer `kbDefinitionsPromise` also has a `.catch` in `server.js`. Never blocks the pipeline.
- **`KB_ENHANCE_ENABLED=false`** (default): `kbApiClient` is `null`, `kbDefinitionsPromise` resolves to `""` immediately, pipeline unchanged.

### Deviations from spec

- **`matched_seed_keywords` field**: The spec references `mergedTopics[*].matched_seed_keywords` but this field was not present in the existing test fixtures for `kb_topic_match.js`. The implementation reads it defensively (`Array.isArray(seeds)` guard) so it works when the KB service starts returning it and silently skips for now. No existing tests needed updating.
- **`definitionsPerKeyword = 0` default**: The spec shows `KB_DEFINITIONS_PER_KEYWORD = 0` meaning "all". The `keywordResolveBatch` client previously had no such param; it was added with a default of 0 to stay backward-compatible with Phase 2 callers.

---

# Phase 8 — Config, Envs, and Caps

## Implemented

### Files changed

| File | Change |
|------|--------|
| `src/config/kb_config.js` | New file. Exports `KB_PHASE_FLAGS` (master + 6 per-phase flags), `KB_ENDPOINTS` (base URLs + timeout), `KB_CAPS_DEFAULTS` (all 14 cap env vars with defaults), and `getKbWorkflowConfig(modelId)` (env → workflowDefaults.kb → model overrides merge). `KB_ENDPOINTS` has `serviceBaseUrl` (`KB_SERVICE_BASE_URL`, default port 8004, query-service) and `coreServiceBaseUrl` (`KB_CORE_SERVICE_BASE_URL`, default port 8001, merged core-service). (**Note**: original had separate `dataServiceBaseUrl`/`metaServiceBaseUrl`; consolidated to `coreServiceBaseUrl` after the three services were merged.) |
| `src/config/model_config.js` | Added `workflowDefaults.kb: {}` placeholder; added `workflowOverrides.kb: { topic_match_limit: 3, graphrag_limit: 3, topic_merge_limit: 4, definitions_max_keywords: 10 }` to the `gpt-4o` entry (matches spec example). |
| `src/kb_api/client.js` | Added optional `onCallComplete({ endpoint, durationMs, success })` callback to constructor. Fired at the end of each `#get`/`#post` call on success, HTTP error, or parse failure. Backward-compatible: existing callers that omit `onCallComplete` are unaffected. |
| `src/server.js` | (a) Replaced singleton `kbApiClient` with `kbApiBaseConfig` (plain object) + per-request `KbApiClient` creation inside `handleMessageWithProvider` using the per-request stats callback. (b) Added `kbPhaseFlags` object read from env with master-flag defaulting. (c) Added `kbGlobalStats` Map for process-level per-endpoint counters. (d) Added `GET /v1/debug/kb-stats` endpoint (test-mode only). (e) Added `kbGlobalStats.clear()` to the test reset handler. (f) Added per-phase flag checks at every KB call site (keywordResolve, topicMatch, guidedFilters, metadata, subworkflows, definitions). (g) Added `mergedTopicsForWorkflow` (empty when guidedFilters phase is off) to decouple topic-match from guided-filters activation. (h) Added `kbCallCount/kbCallTotalMs/kbCallErrorCount` to `kb_topic_match_injected` log and `requestLogContext`; included in `writeRequestLog` details. (i) Added `kbPhaseFlags` to `service_start` log. (j) Imported `getKbWorkflowConfig` and computed `kbModelConfig` per request for future use by KB call sites. (k) Added `KB_CORE_SERVICE_BASE_URL` (`kbApiCoreBaseUrl`) passed as `coreBaseUrl` to `KbApiClient` for routing core-service calls to port 8001. |
| `test/config/kb_config.test.js` | New file. 26 tests: KB_PHASE_FLAGS structure + default values, KB_ENDPOINTS structure + defaults, KB_CAPS_DEFAULTS structure + all default values, `getKbWorkflowConfig` merge order (env → defaults → gpt-4o overrides), KbApiClient logging shape (kb_api_response fields, kb_api_failed fields, onCallComplete success and error callbacks). |

### Architecture decisions

- **Per-request KbApiClient**: Creating a fresh `KbApiClient` per request (not a shared singleton) allows attaching a per-request `onCallComplete` callback without shared-state race conditions. The client is a very lightweight value object (no persistent connections), so instantiation cost is negligible.
- **`kbGlobalStats` in `createServer` scope**: The debug endpoint lives in the same closure, so process-level stats are naturally scoped to the server instance. This is consistent with how other server-scoped state (registry, availability) is managed.
- **`mergedTopicsForWorkflow` vs `mergedTopics`**: `mergedTopics` is used for KB topics context injection (Phase 3) and definitions collection (Phase 7); `mergedTopicsForWorkflow` is passed to the workflow for guided filter derivation (Phase 4). Separating them allows disabling Phase 4 independently without affecting Phase 3/7.
- **`kbModelConfig` computed but not yet propagated**: `getKbWorkflowConfig(model.id)` is called per request and its result stored in `kbModelConfig`. The existing KB orchestrator functions still read from `process.env` directly. Per-model cap propagation (e.g., passing `kbModelConfig.topic_match_limit` to `runKbTopicMatch`) is deferred to a future phase — the infrastructure is in place.

### Deviations from spec

- **`kbModelConfig` not yet threaded to orchestrator functions**: The spec says "per-model overrides applied during routing." The config is computed and available, but passing it to `runKbTopicMatch`, `runKbSubworkflows`, and `fetchKbDefinitions` would require changing those function signatures and their tests. This is deferred to avoid touching 7 existing test files. The `getKbWorkflowConfig` function is wired and tested; applying it at call sites is a backward-compatible follow-up.

---

# Phase 9 — Rollout and Testing

## Implemented

### Files changed

| File | Change |
|------|--------|
| `test_support/kb_mock.js` | New file. Express-based in-process mock for all 9 kb-service endpoints. Features: per-endpoint `setBehavior({status, body, delay})`, `setAllError(status)`, `callCountFor(endpoint)`, `callsFor(endpoint)`, `totalCallCount()`, `reset()`, `start()`/`stop()`. |
| `test/integration/kb_enhance.integration.test.js` | New file. 5 integration scenarios (TEST_MODE=true only): (1) KB enabled + basic jain question → topics_match/graphrag/keyword_resolve_batch called; (2) KB down → graceful degradation, answer still returned; (3) KB master flag off → 0 KB calls; (4) per-phase definitions+keywordResolve flags off → keyword_resolve_batch not called; (5) backward-compat old agent API → valid answer without guided passages. |
| `src/testing/test_provider_factory.js` | Added `JAIN_QUESTION` trigger (returns `keywords: ["आत्मा"]` + `jain_keywords: ["आत्मा"]`) and `DIRECT_RETRIEVAL_QUESTION` trigger (returns `kb_subworkflows: [{name: "direct_retrieval", ...}]`). Default keyword extraction response now includes all new fields (`jain_keywords`, `normal_keywords`, `kb_subworkflows`, `kb_entities`) as nullable values. |
| `docs/jain_kb_service/manual_testing.md` | New file. 6 manual test scenarios with curl commands: basic jain question, 3 sub-workflow types (direct_retrieval, search_topic_in_shastra, search_shastra_for_topics), typo/fuzzy suggestion test, and KB disabled baseline. Includes observability table for `kb_topic_match_injected` log fields and context ordering reference. |

### Architecture decisions

- **Separate kb mock server (not in-process stub)**: The KB mock is a real Express HTTP server on a random port. This exercises the full HTTP path of `KbApiClient` (including AbortController timeouts and `onCallComplete` stats) rather than only unit-testing at the function level.
- **`setAllError` for graceful degradation test**: Rather than mocking a TCP-unreachable port (which would cause OS-level timeouts), `setAllError(500)` returns immediately with a 500 status. This makes the degradation test fast and deterministic.
- **Per-phase test (Scenario 4) uses env var mutation**: `KB_ENHANCE_DEFINITIONS` and `KB_ENHANCE_KEYWORD_RESOLVE` are set in the test process env before `createServer` is called, then restored in `finally`. This is consistent with how other env-driven tests work in this codebase.
- **`JAIN_QUESTION` / `DIRECT_RETRIEVAL_QUESTION` in test provider**: These string sentinels in the question content let integration tests trigger specific LLM output paths without needing a real LLM. The pattern follows the existing `FORCE_FOLLOWUP` sentinel already in the codebase.
- **Observability**: `GET /v1/debug/kb-stats` exposes per-endpoint counters accumulated by `KbApiClient.onCallComplete`. Reset via `POST /v1/test/reset` (existing test endpoint). This lets integration tests assert which KB endpoints were or weren't called after a chat request.

### Deviations from spec

- **Integration tests skip in non-TEST_MODE environments**: All integration tests use `test.skip` when `TEST_MODE != "true"`, matching the existing integration test pattern. They run in docker compose with `TEST_MODE=true`.
- **Scenario 4 uses env mutation rather than a new server per env combo**: The server `createServer` reads phase flags from `process.env` at construction time (not from `KB_PHASE_FLAGS` module singleton, which is evaluated at module load). So per-request env mutation before `createServer()` works correctly for the integration tests.
- **`kbModelConfig` not used yet in orchestrator calls** (see Phase 8 deviation note above). The config is computed per-request and is ready for future propagation.

---

# Live Verification Against Real Services (2026-06-21)

The full KB integration was verified end-to-end against the **live**
`query-service` (port 8004) and `core-service` (port 8001), not just mocks.
The integration suite mocks all KB responses, so it could not catch shapes that
differed from the real services. Verification exercised the real `KbApiClient`
plus the orchestrator modules (`runKbTopicMatch`, `fetchKbMetadataMatches`,
`runKbSubworkflows`) against real data (e.g. `आत्मा`, `द्रव्य`, `समयसार`,
`कुन्दकुन्द`). Several contract mismatches were found and fixed.

## Bugs found & fixed

### query-service (`dictionary-and-metadata-service`)

1. **`POST /v1/query/topics_match` 500 when `include_references=true`.**
   The router called `graphrag_pipeline._fetch_raw_blocks(...)`, a function that
   does not exist → `AttributeError` → 500 on every references request (this is
   the default; the chat Phase-3 path always sends `include_references=true`).
   **Fix:** added `topics_match.fetch_topic_references_batch()` (reuses the
   common `hydrate_topic_extracts_hi`, flattens + de-dupes per topic exactly like
   `graphrag.hydrate_topics`) and rewired the router to use it.
   Files: `services/query_service/pipeline/topics_match.py`,
   `services/query_service/routers/query.py`.

2. **`POST /v1/query/topic_neighbors` 500.** `NeighborGatha.gatha_number` was a
   required, non-nullable `int`, but `bucket_neighbors` emits `gatha_number:
   None` for gathas without a parsed number → pydantic validation error → 500.
   (Also latent in the graphrag `include_neighbors` path.)
   **Fix:** `gatha_number: Optional[int] = None`.
   File: `services/query_service/schemas/topic_match.py`.

### cataloguesearch-chat (`service`)

3. **`topic_neighbors` response shape mismatch — neighbors silently dropped.**
   The live service returns `neighbors_by_anchor` as a **list** of
   `{anchor_topic_natural_key, related_topics, related_keywords,
   mentioned_in_gathas}` (per `07_topic_neighbors_api.md`), but
   `KbApiClient.topicNeighbors` returned it as-is and `attachNeighbors` expects
   an **object map** keyed by natural_key (and explicitly rejects arrays). Result:
   no neighbors / `related:` lines ever attached.
   **Fix:** `topicNeighbors()` now converts the list to a map keyed by
   `anchor_topic_natural_key` (legacy object-map shape still passes through).
   File: `src/kb_api/client.js`.

4. **Resource endpoints returned the wrong shape — Phase 5 metadata fully
   broken.** `GET /v1/shastras|/authors|/teekas` (core-service) return
   `{items:[...], pagination}`, and the display name lives in a localized-string
   array (`title[]` for shastras/teekas, `display_name[]` for authors) — there is
   no flat `name`. The client returned the raw envelope, so `canonicalizeShastra`
   (`Array.isArray(...)? [0] : null`) always got `null` (natural-key resolution
   silently failed for all sub-workflows), and `fetchKbMetadataMatches` /
   `buildKbMetadataSection` produced zero matches (`m.name` undefined).
   **Fix:** added `normalizeResourceItems()` — unwraps `.items` and derives
   `name` from the Hindi entry of `title`/`display_name`; `shastras/authors/teekas`
   now return a flat normalized array. Tolerates bare-array test mocks.
   File: `src/kb_api/client.js`.

5. **`search_shastra_for_topics` rendered `[object Object]`.** The live
   `shastras_for_topic` shastra entries use `shastra_natural_key` / `name_hi` and
   `gathas:[{number, page_number}]`, but `formatKbSubworkflowsContext` read
   `shastraEntry.shastra` and `gathas.join(", ")` on objects.
   **Fix:** read `name_hi || shastra_natural_key`, map gathas to their `number`
   (dropping null/0 placeholders) before joining.
   File: `src/orchestrator/kb_subworkflows.js`.

## Verified working end-to-end (live)

- Phase 2 keyword resolve — `exact` match + Hindi definitions hydrated.
- Phase 3 topic match → neighbors — 5 merged topics, neighbors attached
  (`mentioned_in_gathas`), `KB-T-*` citations, `related:` line rendered.
- Phase 5 metadata — shastra + author matches with correct Hindi names + sims.
- Phase 6 sub-workflows — `search_topic_in_shastra` (25 topics) and
  `search_shastra_for_topics` (7 shastras) canonicalize the shastra/topic and
  render cleanly.
- Phase 3b graphrag endpoint — 200, neighbors + references hydrate without error.

## Tests

- `test/kb_api/client.test.js`: +4 real-shape contract tests (shastras `{items}`
  + `title[]` name; authors `display_name[]` name; topic_neighbors list→map;
  legacy object-map pass-through).
- `test/integration/kb_enhance.integration.test.js`: `kbTopicNeighborsResponse`
  mock changed from object-map to the real **list** shape so the suite exercises
  the true contract. All 5 scenarios pass.
- Full chat unit + KB integration suites green. (Pre-existing, unrelated
  `model_failover` / `session_restart` integration tests fail at baseline in this
  local env — infra/timing-dependent, untouched by this work.)

## Known limitation (not fixed — needs a new endpoint)

- **`direct_retrieval` sub-workflow.** It maps `(shastra, integer gatha_number)`
  → gatha content fields (`prakrit`/`sanskrit`/`bhaavarth`). In the real data a
  gatha's identity is a compound natural_key path (e.g.
  `परमात्मप्रकाश:अधिकार:1:गाथा:011`), `GET /v1/gathas` does not filter by number,
  and content lives only at `GET /v1/gathas/{ident}` keyed by that full
  natural_key. There is no clean `(shastra_nk, int)` → gatha lookup, and the
  default `want` field `bhaavarth` does not exist (real fields:
  `prakrit`/`sanskrit`/`hindi_chhand`/`word_meanings`). `client.gathaDetail` is
  therefore non-functional against the live core-service. A follow-up requires a
  query/core-service endpoint resolving `(shastra_natural_key, gatha_number)` to
  a gatha and returning the projected content fields. The other two sub-workflows
  are unaffected.
