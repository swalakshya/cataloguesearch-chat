# Manual Verification Checklist — Phase 1 (Jain Keyword Classification)

## Unit test verification

```bash
# From service/ directory
node --test test/config/keyword_schema.test.js test/orchestrator/keyword_extract.test.js
# Expected: 23 tests pass, 0 fail

# Full suite (regression check)
node --test 'test/**/*.test.js' 'test/*.test.js'
# Expected: all existing tests pass (198 pass, 22 skip as before)
```

## Schema verification

Open `src/config/keyword_schema.js` and confirm:

- [ ] `KEYWORD_EXTRACTION_SCHEMA.required` includes `jain_keywords`, `normal_keywords`, `kb_subworkflows`, `kb_entities`
- [ ] `KEYWORD_EXTRACTION_SCHEMA_GUJ_SEARCH.required` includes the same four fields
- [ ] `kb_subworkflows.items.properties.name.enum` = `["direct_retrieval", "search_shastra_for_topics", "search_topic_in_shastra"]`
- [ ] `kb_subworkflows.items.additionalProperties = false`
- [ ] `kb_entities.properties` has `shastra_hints` and `author_hints`

## Prompt file verification

For each of the four prompt files:
- `prompts_sets/prompts_v2/step_1_keyword_extract_and_classification.md`
- `prompts_sets/prompts_v2_gemini-2_5-flash/step_1_keyword_extract_and_classification.md`
- `prompts_sets/prompts_v2_gemini-3-flash-preview/step_1_keyword_extract_and_classification.md`
- `prompts_sets/prompts_v2_gpt-4o/step_1_keyword_extract_and_classification.md`

Confirm each contains:
- [ ] Rule 8 paragraph about `jain_keywords[]` / `normal_keywords[]` classification
- [ ] `## KB Sub-workflow Catalog` section with all three sub-workflow types
- [ ] `direct_retrieval` few-shot example with `gatha_number`
- [ ] `search_shastra_for_topics` few-shot example
- [ ] `search_topic_in_shastra` few-shot example
- [ ] Updated OUTPUT JSON base fields showing `jain_keywords`, `normal_keywords`, `kb_subworkflows`, `kb_entities`

```bash
# Quick check across all four files
grep -l "jain_keywords" service/prompts_sets/prompts_v2*/step_1_keyword_extract_and_classification.md
# Expected: 4 files listed

grep -l "direct_retrieval" service/prompts_sets/prompts_v2*/step_1_keyword_extract_and_classification.md
# Expected: 4 files listed
```

## Orchestrator post-processing verification (manual)

### Case 1: LLM provides partition — must be preserved

Send a question where the mock LLM response includes explicit `jain_keywords` and `normal_keywords`. Confirm they pass through unchanged.

### Case 2: LLM omits partition — Devanagari fallback

Send a response with only `keywords: ["आत्मा", "definition"]` (no `jain_keywords`/`normal_keywords`). Confirm:
- `jain_keywords = ["आत्मा"]`
- `normal_keywords = ["definition"]`

### Case 3: Unknown sub-workflow stripped

Send `kb_subworkflows: [{"name": "unknown_workflow", ...}]`. Confirm it is removed and a `kb_subworkflows_stripped` warn log appears.

### Case 4: Valid sub-workflow kept

Send `kb_subworkflows: [{"name": "direct_retrieval", ...}]`. Confirm it is preserved.

## Live LLM smoke test (requires running service)

```bash
# Start the service
docker compose up --build

# Test 1: Basic question with Jain terms — should classify आत्मा as jain
curl -s -X POST http://localhost:8012/v1/chat/sessions \
  -H 'Content-Type: application/json' -d '{}' | jq .session_id

# Use session_id from above
SESSION_ID=<session_id>

curl -s -X POST http://localhost:8012/v1/chat/sessions/$SESSION_ID/messages \
  -H 'Content-Type: application/json' \
  -d '{"message": "आत्मा क्या है?"}' | jq '{workflow, jain_keywords: .debug.keyword_extract.jain_keywords, normal_keywords: .debug.keyword_extract.normal_keywords}'

# Expected: jain_keywords contains "आत्मा", normal_keywords is empty or has only non-Devanagari words

# Test 2: Question with gatha number — should produce direct_retrieval kb_subworkflow
curl -s -X POST http://localhost:8012/v1/chat/sessions/$SESSION_ID/messages \
  -H 'Content-Type: application/json' \
  -d '{"message": "Samaysaar ki 6vi gatha batao"}' | jq '{kb_subworkflows: .debug.keyword_extract.kb_subworkflows}'

# Expected: kb_subworkflows includes entry with name="direct_retrieval", shastra="Samaysaar", gatha_number=6
```

> Note: `debug.keyword_extract` is only present if the service exposes debug fields in its response. If not, check service logs for `keyword_extract_parsed` log line which contains `jain_keywords`, `normal_keywords`, and `kb_subworkflows_count`.

---

# Phase 2 — Jain Keyword Dictionary Check + Step1b Integration

## Unit test verification

```bash
# From service/ directory
node --test test/orchestrator/kb_keyword_check.test.js test/orchestrator/keyword_fix.test.js
# Expected: 14 tests pass, 0 fail

# Full suite (regression check)
node --test test/**/*.test.js test/*.test.js
# Expected: 233 tests pass, 22 skip, 0 fail
```

## Code verification

Confirm files exist:
```bash
ls service/src/kb_api/client.js
ls service/src/orchestrator/kb_keyword_check.js
```

Confirm `server.js` has the KB wiring:
```bash
grep -n "kbApiClient\|KB_ENHANCE_ENABLED\|runKbKeywordCheck" service/src/server.js
# Expected: multiple lines showing import, config, construction, and call site
```

## Prompt file verification

```bash
# All 4 step_1b prompts should have the new section
grep -l "MISSED_JAIN_KEYWORDS_WITH_SUGGESTIONS" service/prompts_sets/prompts_v2*/step_1b_keyword_fix.md
# Expected: 4 files listed

grep -l "Missed Jain Keywords" service/prompts_sets/prompts_v2*/step_1b_keyword_fix.md
# Expected: 4 files listed
```

## Feature gate verification (KB_ENHANCE_ENABLED=false, default)

Start the service without `KB_ENHANCE_ENABLED` set (or set to `false`):
```bash
docker compose up --build
```

Send a message and confirm in logs:
- `service_start` log has `kbEnhanceEnabled: false`
- No `kb_api_request` log lines appear
- No `kb_keyword_check_split` log lines appear
- Pipeline behaves identically to pre-Phase-2

## Feature gate verification (KB_ENHANCE_ENABLED=true)

Set `KB_ENHANCE_ENABLED=true` and `KB_SERVICE_BASE_URL=<real or mock kb url>`:

### Scenario A: KB service unreachable

```bash
KB_ENHANCE_ENABLED=true KB_SERVICE_BASE_URL=http://localhost:19999 docker compose up
```

Send any message. Confirm:
- `kb_keyword_check_resolve_failed` warn log appears with KB error
- Chat still returns an answer (graceful degradation)

### Scenario B: KB service available, all matched

When KB returns `match_kind: "exact"` for all jain_keywords:
- Check `kb_canonical_rewrite_applied` info log showing the map
- Check that `keywords[]` in the downstream workflow call contain canonical forms
- Confirm `kb_keyword_check_step1b_skip` log with reason `no_misses`

### Scenario C: KB service available, miss with suggestion

When KB returns `match_kind: "none"` with `suggestions[]` for a token:
- Check `kb_keyword_check_step1b_trigger` info log
- Confirm Step1b fires (`keyword_fix_prompt_tokens_estimate` log appears)
- Confirm the Step1b prompt contains the missed token and suggestions (check `keyword_fix_prompt_tokens_estimate` token count is higher than baseline)

### Scenario D: KB service available, miss without suggestions

When KB returns `match_kind: "none"` with empty `suggestions[]`:
- Confirm `kb_keyword_check_step1b_skip` log with reason `no_suggestions_for_misses`
- Confirm Step1b does NOT fire

## Log lines to monitor

| Log message | Level | When |
|-------------|-------|------|
| `kb_keyword_check_skip` | verbose | `jain_keywords` is empty |
| `kb_api_request` | verbose | KB call about to fire |
| `kb_api_response` | info | KB responded OK |
| `kb_api_failed` | warn | KB returned non-2xx |
| `kb_keyword_check_resolve_failed` | warn | KB call threw (timeout, network) |
| `kb_keyword_check_split` | info | matched/missed counts |
| `kb_canonical_rewrite_applied` | info | canonical map applied |
| `kb_keyword_check_step1b_trigger` | info | Step1b about to fire |
| `kb_keyword_check_step1b_skip` | verbose | Step1b skipped and why |

---

# Phase 3 — Topic Match + Extract Injection

## Unit test verification

```bash
# From service/ directory
node --test test/orchestrator/kb_topic_match.test.js
# Expected: 32 tests pass, 0 fail

# Full suite (regression check)
node --test $(find test -name "*.test.js" | grep -v integration | sort)
# Expected: 243 tests pass, 0 fail
```

## Code verification

Confirm new files exist:
```bash
ls service/src/orchestrator/kb_topic_match.js
ls service/test/orchestrator/kb_topic_match.test.js
```

Confirm `client.js` has the new methods:
```bash
grep -n "topicsMatch\|graphrag" service/src/kb_api/client.js
# Expected: 2 method definitions
```

Confirm `server.js` wiring:
```bash
grep -n "topicMatchPromise\|runKbTopicMatch\|formatKbTopicsContext\|kbTopicsSection" service/src/server.js
# Expected: import line, promise creation, await, context injection, and log line
```

## Feature gate verification (KB_ENHANCE_ENABLED=false, default)

Start the service without `KB_ENHANCE_ENABLED` (default):
```bash
docker compose up --build
```

Send a message. Confirm:
- No `kb_topic_match_start` or `kb_api_request` log lines for topic-match paths
- `kb_topic_match_injected` log line shows `topicsCount: 0, injected: false`
- Answer identical to pre-Phase-3

## Feature gate verification (KB_ENHANCE_ENABLED=true)

Set `KB_ENHANCE_ENABLED=true` and `KB_SERVICE_BASE_URL=http://localhost:8004`.

### Scenario A: KB service unreachable

```bash
KB_ENHANCE_ENABLED=true KB_SERVICE_BASE_URL=http://localhost:19999 docker compose up
```

Send any basic question. Confirm:
- `kb_topics_match_call_failed` warn log appears
- `kb_graphrag_call_failed` warn log appears
- `kb_topic_match_complete` log shows `merged: 0`
- `kb_topic_match_injected` shows `injected: false`
- Chat still returns an answer (graceful degradation)

### Scenario B: KB service available

When KB returns results:
- Check `kb_topic_match_start` info log shows correct `keywordSetCount`
- Check `kb_topic_match_complete` info log shows non-zero `merged`
- Check `kb_topic_match_injected` shows `injected: true`
- Verify the `### KB Topics` section appears at the top of the LLM context (enable verbose logging or add a debug endpoint to inspect the prompt)

### Scenario C: metadata_question_v1 — no topic-match

Ask a metadata question (e.g. "How many shastras does CatalogueSearch have?"). Confirm:
- `kb_topic_match_skip` verbose log appears with `reason: no_keyword_sets`
- `kb_topic_match_injected` shows `injected: false`

### Scenario D: followup_question_v1 — per-set calls

Ask a followup question. Confirm:
- `kb_topic_match_start` log shows `keywordSetCount ≥ 2` (root + followup sets)
- Multiple `kb_api_request` log entries for topics_match and graphrag per set

### Scenario E: env cap override

Set `KB_TOPIC_MATCH_LIMIT=3 KB_GRAPHRAG_LIMIT=2 KB_TOPIC_MERGE_LIMIT=2` and send a question. Confirm:
- `kb_topic_match_complete` log shows `merged ≤ 2`

## Log lines to monitor

| Log message | Level | When |
|-------------|-------|------|
| `kb_topic_match_skip` | verbose | workflow not in supported set or no keyword sets |
| `kb_topic_match_start` | info | calls about to fire; shows `keywordSetCount` |
| `kb_topics_match_call_failed` | warn | `/v1/query/topics_match` threw |
| `kb_graphrag_call_failed` | warn | `/v1/query/graphrag` threw |
| `kb_topic_match_complete` | info | merged count after all sets processed |
| `kb_topic_match_injected` | info | whether KB section was prepended to context |

---

# Phase 4 — Guided Filters in Agent API

## Unit test verification

```bash
# From service/ directory

# Phase 4 pure-function tests
node --test test/orchestrator/kb_guided_filters.test.js
# Expected: 13 tests pass, 0 fail

# Agent API client tests (includes backward compat)
node --test test/agent_api/client.test.js
# Expected: 8 tests pass, 0 fail

# Workflow tests (all 4 retrieval workflows updated)
node --test test/orchestrator/workflows/
# Expected: 30 tests pass, 0 fail

# Chunk utils (includes buildGuidedContext)
node --test test/utils/chunk_utils.test.js
# Expected: 14 tests pass, 0 fail

# Full suite regression check
node --test test/**/*.test.js test/**/**/*.test.js
# Expected: 303+ tests pass, 0 fail
```

## Code verification

Confirm new file exists:
```bash
ls service/src/orchestrator/kb_guided_filters.js
ls service/test/orchestrator/kb_guided_filters.test.js
```

Confirm `client.js` has the normalizer:
```bash
grep -n "normalizeSearchResponse\|guided_results" service/src/agent_api/client.js
# Expected: normalizeSearchResponse function definition, reference in search()
```

Confirm `chunk.js` has the new export:
```bash
grep -n "buildGuidedContext" service/src/utils/chunk.js
# Expected: export function definition
```

Confirm `server.js` changes (sequential topicMatch + guidedResults handling):
```bash
grep -n "mergedTopics\|guidedResults\|guidedSection\|allHashedChunks\|guidedRawChunks" service/src/server.js
# Expected: mergedTopics await, destructuring from workflowOutcome, guidedSection in context join
```

Confirm all 4 workflow files import and use guided filters:
```bash
grep -l "deriveGuidedFilters\|guided_filters\|guidedResults" service/src/orchestrator/workflows/*.js
# Expected: 4 files (basic, followup, advanced_distinct, advanced_nested)
```

## Feature gate verification (KB_ENHANCE_ENABLED=false, default)

Start the service without `KB_ENHANCE_ENABLED` (default):
```bash
docker compose up --build
```

Send any search question. Confirm:
- `kb_topic_match_injected` log shows `guidedResultSets: 0, guidedChunks: 0`
- No `guided_filters` field in any `external_api_request` verbose log
- Answer identical to pre-Phase-4
- `### Guided Passages` section NOT present in any LLM prompt

## Feature gate verification (KB_ENHANCE_ENABLED=true)

Set `KB_ENHANCE_ENABLED=true` and `KB_SERVICE_BASE_URL=http://localhost:8004`.

### Scenario A: KB topics return references → guided_filters in search

Ask a basic question about a Jain concept (e.g. "समयसार में द्रव्य"). With KB enabled and topics returned:

Expected logs:
- `kb_topic_match_start` fires (now sequential before workflow, not parallel)
- `kb_topic_match_complete` shows `merged > 0`
- `external_api_request` verbose log contains `guided_filters: [...]` in the search payload
- `kb_topic_match_injected` shows `guidedResultSets: N, guidedChunks: M`

If agent API has been updated to return `guided_results`:
- `kb_topic_match_injected` shows non-zero `guidedChunks`
- LLM context contains `### Guided Passages (kb-suggested filters)` section

### Scenario B: Agent API not yet updated (backward compat)

When the agent API still returns a flat array (or envelope without `guided_results`):
- `normalizeSearchResponse` silently produces `guided_results: []`
- `guidedResultSets: 0` in the log
- No `### Guided Passages` section in prompt
- Answer proceeds normally — no error, no degradation

Verify by temporarily disabling `guided_results` in a local mock:
```bash
# The test stub (src/testing/test_external_api.js) returns guided_results: []
# which simulates the backward compat path. Run integration tests:
node --test test/integration/
# Expected: all pass with no guided section in context
```

### Scenario C: KB service unreachable → no guided_filters

```bash
KB_ENHANCE_ENABLED=true KB_SERVICE_BASE_URL=http://localhost:19999 docker compose up
```

Send any question. Confirm:
- KB topic match fails (warn logs)
- `mergedTopics` is `[]`
- `deriveGuidedFilters([])` returns `[]`
- No `guided_filters` field in search payload
- Identical behaviour to KB disabled

### Scenario D: Cap enforcement

```bash
KB_GUIDED_FILTERS_CAP=2 KB_ENHANCE_ENABLED=true docker compose up
```

Ask a question where KB returns topics with many references. Confirm:
- `guided_filters` array in search payload has at most 2 entries
- `kb_topic_match_injected` shows `guidedResultSets ≤ 2`

### Scenario E: Guided sections in LLM context

Enable debug logging (`LOG_LEVEL=verbose`) and ask a question where guided results are returned. Verify the Step2 context string looks like:

```
### KB Topics (Hindi extracts, closest first)
- topic: ...

### Vector Passages (default)
Source 1:
...

### Guided Passages (kb-suggested filters)
- filter: shastra=samaysaar, gatha=6
  Source 1:
  ...
```

### Scenario F: Citations from guided passages

When the LLM cites a chunk from the guided passages section, confirm:
- The citation resolves correctly in `buildChunkCitationMap` (guided chunks are in `allHashedChunks`)
- The reference appears in `structured.references`
- `answer_parsed` log shows non-zero `referencesCount`

## Log lines to monitor

| Log message | Level | When |
|-------------|-------|------|
| `kb_topic_match_start` | info | Now fires sequentially before workflow |
| `kb_topic_match_injected` | info | Shows `guidedResultSets`, `guidedChunks`, `topicsCount`, `injected` |
| `workflow_complete` | info | Now logs `guidedResultSets` count |
| `external_api_request` | verbose | Check for `guided_filters` in payload when KB has topics |

## Backward compat verification

Quick local check (no running service needed):

```bash
# Run all tests including the backward-compat test in basic.test.js:
# "basic workflow proceeds normally when search returns no guided_results field (backward compat)"
node --test test/orchestrator/workflows/basic.test.js
# Expected: all 12 tests pass including the backward compat test
```

---

# Phase 5 — Metadata Enhancement (parallel kb + cataloguesearch)

## Unit test verification

```bash
# From service/ directory

# New Phase 5 tests
node --test test/kb_api/client.test.js
# Expected: 7 tests pass, 0 fail

node --test test/orchestrator/kb_metadata_match.test.js
# Expected: 14 tests pass, 0 fail

node --test test/orchestrator/workflows/metadata_question_v1.test.js
# Expected: 8 tests pass, 0 fail

# Full suite regression check
node --test test/**/*.test.js test/**/**/*.test.js
# Expected: 333 tests pass (311 pass + 22 skip), 0 fail
```

## Code verification

Confirm new files exist:
```bash
ls service/src/orchestrator/kb_metadata_match.js
ls service/test/orchestrator/kb_metadata_match.test.js
ls service/test/orchestrator/workflows/metadata_question_v1.test.js
ls service/test/kb_api/client.test.js
```

Confirm `KbApiClient` has the three new methods:
```bash
grep -n "shastras\|authors\|teekas\|#get" service/src/kb_api/client.js
# Expected: 3 public method definitions + #get helper
```

Confirm `workflow_router.js` passes kbApiClient and returns kbMetadataSection:
```bash
grep -n "kbApiClient\|kbMetadataSection" service/src/orchestrator/workflow_router.js
# Expected: param in signature, in runner call, extracted from result, in return
```

Confirm `server.js` wiring:
```bash
grep -n "kbMetadataPromise\|kbMetadataSection\|fetchKbMetadataMatches\|buildKbMetadataSection" service/src/server.js
# Expected: import, promise creation, kbApiClient passed to retry, section resolution, context injection
```

## Feature gate verification (KB_ENHANCE_ENABLED=false, default)

Start the service without `KB_ENHANCE_ENABLED` set:
```bash
docker compose up --build
```

Send a metadata question (e.g. "Which shastras are available?"). Confirm:
- No `kb_api_request` log lines for core-service paths (`/v1/shastras`, `/v1/authors`, etc.)
- `kb_topic_match_injected` log shows `kbMetadataSectionPresent: false`
- Context identical to pre-Phase-5

## Feature gate verification (KB_ENHANCE_ENABLED=true)

Set `KB_ENHANCE_ENABLED=true` and `KB_SERVICE_BASE_URL=http://localhost:8004`.

### Scenario A: metadata_question_v1 with shastra_hint

Ask a metadata question where Step 1 extracted `kb_entities.shastra_hints = ["samaysaar"]`.

Expected logs:
- `kb_api_request` log with path `/v1/shastras?q=samaysaar&fuzzy=true&limit=5` (on `KB_CORE_SERVICE_BASE_URL`)
- `kb_metadata_matches_fetched` info log showing non-zero `shastraMatches`
- `kb_topic_match_injected` log shows `kbMetadataSectionPresent: true`

Expected context (check `metadata_context_for_llm` verbose log):
```
### KB Metadata Matches (closest first)
- shastra: समयसार (nk=samaysaar, sim=0.XX)

Source 1:
{
  "kind": "metadata",
  ...CatalogueSearch options...
}
```

### Scenario B: non-metadata workflow with kb_entities hints

Ask a basic question where Step 1 extracted `kb_entities.author_hints = ["kundkund"]`.

Expected logs:
- `kb_api_request` log with path `/v1/authors?q=kundkund&fuzzy=true&limit=5` (on `KB_CORE_SERVICE_BASE_URL`)
- `kb_metadata_matches_fetched` info log
- `kb_topic_match_injected` shows `kbMetadataSectionPresent: true`

The `### KB Metadata Matches` section should appear at the top of the Step2 context.

### Scenario C: no hints → no kb metadata calls

Ask a question where `kb_entities = { shastra_hints: [], author_hints: [] }`. Confirm:
- No core-service calls (`/v1/shastras`, `/v1/authors`, etc.) in logs
- `kbMetadataSectionPresent: false`

### Scenario D: kb service timeout → workflow still succeeds

With `KB_SERVICE_BASE_URL` pointing to a port that times out (e.g. `http://localhost:19999`):
```bash
KB_ENHANCE_ENABLED=true KB_SERVICE_BASE_URL=http://localhost:19999 docker compose up
```

Ask a metadata question with hints. Confirm:
- `kb_shastras_failed` or `kb_metadata_match_pipeline_failed` warn log appears
- Chat still returns an answer (graceful degradation)
- `kbMetadataSectionPresent: false`

### Scenario E: kb returns no fuzzy match → section omitted

When `/v1/shastras` returns `[]` for a given hint. Confirm:
- `kb_metadata_matches_fetched` shows `shastraMatches: 0`
- `### KB Metadata Matches` heading does NOT appear in context
- `kbMetadataSectionPresent: false`

### Scenario F: both lists side-by-side for LLM reconciliation

With both shastra and author hints:
- `kb_entities.shastra_hints = ["samaysaar"]`, `author_hints = ["kundkund"]`

Expected context top section:
```
### KB Metadata Matches (closest first)
- shastra: समयसार (nk=samaysaar, sim=0.78)
- author:  Kundkund Acharya (nk=kundkund, sim=0.90)
```
Both lines present; CatalogueSearch metadata follows as normal.

## Log lines to monitor

| Log message | Level | When |
|-------------|-------|------|
| `kb_shastras_failed` | warn | Per-hint shastras call threw (timeout etc.) |
| `kb_authors_failed` | warn | Per-hint authors call threw |
| `kb_metadata_match_pipeline_failed` | warn | Outer kb metadata promise threw (server.js) |
| `kb_metadata_match_failed` | warn | Outer kb metadata promise threw (inside metadata workflow) |
| `kb_metadata_matches_fetched` | info | Both hint counts and match counts |
| `kb_topic_match_injected` | info | Now includes `kbMetadataSectionPresent` field |

---

# Phase 6 — KB Sub-workflow Dispatch

## Unit test verification

```bash
# From service/ directory

# New Phase 6 kb_api client tests (15 total, 8 new)
node --test test/kb_api/client.test.js
# Expected: 15 tests pass, 0 fail

# New Phase 6 sub-workflow tests
node --test test/orchestrator/kb_subworkflows.test.js
# Expected: 26 tests pass, 0 fail

# Full suite regression check
node --test $(find test -name "*.test.js" | grep -v integration | sort)
# Expected: 345 tests pass, 0 fail
```

## Code verification

Confirm new files exist:
```bash
ls service/src/orchestrator/kb_subworkflows.js
ls service/test/orchestrator/kb_subworkflows.test.js
```

Confirm `KbApiClient` has the three new methods:
```bash
grep -n "gathaDetail\|topicsInShastra\|shastrasForTopic" service/src/kb_api/client.js
# Expected: 3 public method definitions
```

Confirm `server.js` wiring:
```bash
grep -n "kbSubworkflowsPromise\|kbSubworkflowsSection\|runKbSubworkflows\|formatKbSubworkflowsContext" service/src/server.js
# Expected: import, promise creation, await, section in context join, log field
```

Confirm workflow guideline files were updated:
```bash
grep -l "KB Sub-workflow Results" service/prompts_sets/prompts_v2/workflow_answering_guidelines/*.md
# Expected: 4 files listed
```

## Feature gate verification (KB_ENHANCE_ENABLED=false, default)

Start the service without `KB_ENHANCE_ENABLED` set:
```bash
docker compose up --build
```

Send any search question. Confirm:
- `kb_topic_match_injected` log shows `kbSubworkflowsCount: 0`
- No `kb_subworkflows_start` log lines appear
- `### KB Sub-workflow Results` NOT present in LLM context
- Answer identical to pre-Phase-6

## Feature gate verification (KB_ENHANCE_ENABLED=true)

Set `KB_ENHANCE_ENABLED=true` and `KB_SERVICE_BASE_URL=http://localhost:8004`.

### Scenario A: direct_retrieval — specific gatha fetch

Ask a question where Step 1 produces `kb_subworkflows: [{ name: "direct_retrieval", shastra: "Samaysaar", gatha_number: 6, want: ["prakrit", "bhaavarth"] }]`.

Expected logs:
- `kb_subworkflows_start` info log shows `count: 1, names: ["direct_retrieval"]`
- `kb_api_request` log with path `/v1/shastras?q=Samaysaar&...` (canonicalization call, on `KB_CORE_SERVICE_BASE_URL`)
- `kb_api_request` log with path `/v1/gathas?shastra=samaysaar&number=6`
- `kb_subworkflow_direct_retrieval_complete` info log shows `fields: ["prakrit","bhaavarth"]`
- `kb_topic_match_injected` shows `kbSubworkflowsCount: 1`

Expected context section:
```
### KB Sub-workflow Results

[direct_retrieval] samaysaar gatha 6:
  prakrit: ...
  bhaavarth: ...
```

### Scenario B: search_topic_in_shastra — topics in gatha

Ask a question where Step 1 produces `kb_subworkflows: [{ name: "search_topic_in_shastra", shastra: "Samaysaar", gatha_number: 6 }]`.

Expected logs:
- `kb_api_request` with path `/v1/query/topics_in_shastra?shastra=samaysaar&gatha_number=6&limit=25`
- `kb_subworkflow_topics_in_shastra_complete` shows non-zero `topicsCount`

Expected context section:
```
[search_topic_in_shastra] samaysaar gatha 6 topics:
  - द्रव्य/स्वरूप (3)
  - ...
```

### Scenario C: search_shastra_for_topics — find shastras for a topic

Ask a question where Step 1 produces `kb_subworkflows: [{ name: "search_shastra_for_topics", topic: "द्रव्य" }]`.

Expected logs:
- `kb_api_request` with path `/v1/query/topics_match` (topicsMatch resolution)
- `kb_api_request` with path `/v1/query/shastras_for_topic?topic=...`
- `kb_subworkflow_shastras_for_topic_complete` shows non-zero `shastraCount`

Expected context section:
```
[search_shastra_for_topics] topic = द्रव्य/स्वतंत्रता:
  - समयसार: gathas 6, 49
  - प्रवचनसार: gatha 12
```

### Scenario D: cap enforcement

Set `KB_SUBWORKFLOWS_MAX=2`. Ask a question that produces 4 sub-workflows. Confirm:
- `kb_subworkflows_start` shows `count: 2` (not 4)
- `kb_topic_match_injected` shows `kbSubworkflowsCount: 2`

### Scenario E: timeout — slow KB sub-workflow dropped

Set `KB_SUBWORKFLOW_TIMEOUT_MS=100` and have the KB data service respond slowly (>100ms). Confirm:
- `kb_subworkflow_failed` warn log appears with `timeout: true`
- The timed-out entry is absent from the `### KB Sub-workflow Results` section
- Chat still returns an answer (graceful degradation)
- `kb_subworkflows_complete` shows `successful < total`

### Scenario F: KB service unreachable — sub-workflows silently omitted

Set `KB_SERVICE_BASE_URL=http://localhost:19999` (unreachable). Ask a question with sub-workflows. Confirm:
- `kb_subworkflow_failed` warn logs appear
- `kb_subworkflows_pipeline_failed` warn log if the outer promise rejects
- `kbSubworkflowsCount: 0` in the log
- `### KB Sub-workflow Results` NOT present in context
- Chat answer returned normally

### Scenario G: metadata_question_v1 — no sub-workflows

Ask a metadata question. Confirm:
- `kb_subworkflows_start` log does NOT appear
- `kbSubworkflowsCount: 0`

## Log lines to monitor

| Log message | Level | When |
|-------------|-------|------|
| `kb_subworkflows_start` | info | Sub-workflow run starting; shows count and names |
| `kb_subworkflow_invalid_entry` | warn | Entry missing required field (shastra, gatha_number, topic) |
| `kb_subworkflow_unknown` | warn | Unknown sub-workflow name in entries |
| `kb_subworkflow_direct_retrieval_complete` | info | direct_retrieval finished; shows projected fields |
| `kb_subworkflow_topics_in_shastra_complete` | info | search_topic_in_shastra finished; shows topicsCount |
| `kb_subworkflow_shastras_for_topic_complete` | info | search_shastra_for_topics finished; shows shastraCount |
| `kb_subworkflow_topic_resolve_failed` | warn | topicsMatch call failed during topic resolution |
| `kb_subworkflow_failed` | warn | Dispatch threw error or timed out; `timeout: true` if timeout |
| `kb_subworkflows_complete` | info | All entries processed; shows total and successful counts |
| `kb_subworkflows_pipeline_failed` | warn | Outer promise threw (server.js outer catch) |
| `kb_topic_match_injected` | info | Now includes `kbSubworkflowsCount` field |

---

# Phase 7 — Jain Keyword Definitions in Step2 Context

## Unit test verification

```bash
# From service/ directory

# New Phase 7 tests
node --test test/orchestrator/kb_definitions.test.js
# Expected: 24 tests pass, 0 fail

# Full suite regression check
node --test $(find test -name "*.test.js" | grep -v integration | sort)
# Expected: 369 tests pass, 0 fail
```

## Code verification

Confirm new file exists:
```bash
ls service/src/orchestrator/kb_definitions.js
ls service/test/orchestrator/kb_definitions.test.js
```

Confirm `KbApiClient.keywordResolveBatch` accepts `definitionsPerKeyword`:
```bash
grep -n "definitionsPerKeyword\|definitions_per_keyword" service/src/kb_api/client.js
# Expected: 2 lines (opt in signature, key in payload)
```

Confirm `server.js` wiring:
```bash
grep -n "kbDefinitionsPromise\|kbDefinitionsSection\|collectUsedJainKeywords\|fetchKbDefinitions" service/src/server.js
# Expected: import line, promise creation, await, context injection, log field
```

Confirm context ordering in `server.js`:
```bash
grep -n "kbMetadataSection, kbDefinitionsSection, kbTopicsSection" service/src/server.js
# Expected: 1 line (the context assembly join)
```

## Feature gate verification (KB_ENHANCE_ENABLED=false, default)

Start the service without `KB_ENHANCE_ENABLED` set:
```bash
docker compose up --build
```

Send any search question. Confirm:
- No `kb_definitions_start` log lines appear
- `kb_topic_match_injected` log shows `kbDefinitionsSectionPresent: false`
- `### KB Definitions (Hindi)` NOT present in LLM context
- Answer identical to pre-Phase-7

## Feature gate verification (KB_ENHANCE_ENABLED=true)

Set `KB_ENHANCE_ENABLED=true` and `KB_SERVICE_BASE_URL=http://localhost:8004`.

### Scenario A: KB service available, jain_keywords present

Ask a question that produces `jain_keywords: ["आत्मा", "द्रव्य"]` in Step 1.

Expected logs:
- `kb_definitions_start` info log with `keywords: 2`
- `kb_api_request` log with path `/v1/query/keyword_resolve_batch`
- `kb_definitions_fetched` info log with `withDefinitions > 0`
- `kb_topic_match_injected` log shows `kbDefinitionsSectionPresent: true`

Expected context (enable `LOG_LEVEL=verbose` to inspect the prompt):
```
### KB Definitions (Hindi)
- आत्मा (nk=आत्मा):
    1. <definition block>
- द्रव्य (nk=द्रव्य):
    1. <definition block>

### KB Topics (Hindi extracts, closest first)
...
```

### Scenario B: No jain_keywords → no definitions call

Ask a question where `jain_keywords: []` (no Jain terms classified).

Expected:
- `kb_definitions_skip` verbose log with `reason: no_jain_keywords`
- No `kb_api_request` log for `/v1/query/keyword_resolve_batch` (from definitions call)
- `kbDefinitionsSectionPresent: false`

### Scenario C: KB service unreachable → definitions omitted, pipeline continues

```bash
KB_ENHANCE_ENABLED=true KB_SERVICE_BASE_URL=http://localhost:19999 docker compose up
```

Ask a question with Jain keywords. Confirm:
- `kb_definitions_failed` warn log appears
- `kbDefinitionsSectionPresent: false`
- Chat still returns an answer (graceful degradation)
- `### KB Definitions (Hindi)` NOT in context

### Scenario D: metadata_question_v1 → no definitions

Ask a metadata question. Confirm:
- `kb_definitions_start` log does NOT appear
- `kbDefinitionsSectionPresent: false`

### Scenario E: Cap enforcement

```bash
KB_DEFINITIONS_MAX_KEYWORDS=3 KB_ENHANCE_ENABLED=true docker compose up
```

Ask a question that produces 5+ `jain_keywords`. Confirm:
- `kb_definitions_start` log shows `keywords: 3` (not 5+)
- Batch call contains only 3 tokens

### Scenario F: Per-keyword limit

```bash
KB_DEFINITIONS_PER_KEYWORD=2 KB_ENHANCE_ENABLED=true docker compose up
```

Confirm in `kb_api_request` verbose log that the POST body contains `definitions_per_keyword: 2`.

### Scenario G: matched_seed_keywords from topics included

When topics returned by Phase 3 have `matched_seed_keywords: ["कर्म"]` and `jain_keywords: ["आत्मा"]`:
- `kb_definitions_start` should show `keywords: 2` (आत्मा + कर्म)
- Both should appear in the definitions section if KB has them

## Context ordering verification

Enable verbose logging and check the full Step2 prompt. The sections should appear in this order:
1. `### KB Metadata Matches` (if any — Phase 5)
2. `### KB Definitions (Hindi)` (if any — Phase 7)
3. `### KB Topics (Hindi extracts, closest first)` (if any — Phase 3)
4. `### KB Sub-workflow Results` (if any — Phase 6)
5. `### Vector Passages (default)` / chunk context (existing)
6. `### Guided Passages (kb-suggested filters)` (if any — Phase 4)

## Log lines to monitor

| Log message | Level | When |
|-------------|-------|------|
| `kb_definitions_skip` | verbose | `usedJainKeywords` is empty |
| `kb_definitions_start` | info | Batch KB call about to fire; shows keyword count |
| `kb_definitions_empty` | verbose | KB returned empty array |
| `kb_definitions_fetched` | info | KB responded; shows `total` and `withDefinitions` counts |
| `kb_definitions_failed` | warn | KB call threw (timeout, network, non-2xx) |
| `kb_definitions_pipeline_failed` | warn | Outer promise threw (server.js outer catch) |
| `kb_topic_match_injected` | info | Now includes `kbDefinitionsSectionPresent` field |

---

# Phase 8 — Config, Envs, and Caps

## Unit test verification

```bash
# From service/ directory

# New Phase 8 config tests (26 tests)
node --test test/config/kb_config.test.js
# Expected: 26 tests pass, 0 fail

# Full suite regression check
node --test $(find test -name "*.test.js" | grep -v integration | sort)
# Expected: 395 tests pass, 0 fail
```

## Code verification

Confirm new file exists:
```bash
ls service/src/config/kb_config.js
```

Confirm `KB_PHASE_FLAGS` has all 7 keys:
```bash
grep -n "keywordResolve\|topicMatch\|guidedFilters\|metadata\|subworkflows\|definitions\|masterEnabled" service/src/config/kb_config.js
# Expected: 7 lines in the KB_PHASE_FLAGS object
```

Confirm `getKbWorkflowConfig` exists:
```bash
grep -n "getKbWorkflowConfig" service/src/config/kb_config.js service/src/server.js
# Expected: definition in kb_config.js, import + call in server.js
```

Confirm `model_config.js` has `kb` entries:
```bash
grep -n '"kb"' service/src/config/model_config.js
# Expected: at least 2 lines (workflowDefaults.kb and gpt-4o workflowOverrides.kb)
```

Confirm `KbApiClient` has `onCallComplete`:
```bash
grep -n "onCallComplete\|_onCallComplete" service/src/kb_api/client.js
# Expected: constructor assignment + calls in #get and #post
```

## Per-phase flag verification

Start with all flags enabled, then disable one at a time to verify staged rollout:

```bash
# All phases enabled
KB_ENHANCE_ENABLED=true docker compose up --build

# Phase 7 (definitions) disabled only
KB_ENHANCE_ENABLED=true KB_ENHANCE_DEFINITIONS=false docker compose up --build
# Expected: No kb_definitions_start log, kbDefinitionsSectionPresent: false

# Phase 3 (topics) disabled only
KB_ENHANCE_ENABLED=true KB_ENHANCE_TOPIC_MATCH=false docker compose up --build
# Expected: No kb_topic_match_start log, topicsCount: 0, injected: false

# Phase 4 (guided filters) disabled only
KB_ENHANCE_ENABLED=true KB_ENHANCE_GUIDED_FILTERS=false docker compose up --build
# Expected: topics still fetched but no guided_filters sent to agent API
```

## Per-model override verification

Ask a question using `gpt-4o` as the provider. Check `kb_topic_match_start` log:

```bash
# gpt-4o has topic_match_limit: 3 (vs default 5)
# Ask with gpt-4o forced (requires setting priority or disabling other models)
# Look for: kb_topic_match_start with mergedTopics <= 3
```

## Debug endpoint verification

With `TEST_MODE=true`:

```bash
# Get per-endpoint KB stats after a request
curl -s http://localhost:8012/v1/debug/kb-stats | jq .
# Expected: {
#   "stats": { "/v1/query/topics_match": { count: N, totalMs: M, errorCount: 0 }, ... },
#   "kbEnhanceEnabled": true,
#   "kbPhaseFlags": { keywordResolve: true, ... }
# }

# Stats reset on test reset
curl -s -X POST http://localhost:8012/v1/test/reset
curl -s http://localhost:8012/v1/debug/kb-stats | jq .stats
# Expected: {} (empty)
```

## Per-request stats in logs

After a request with KB enabled, check `kb_topic_match_injected` log for:

| Field | Expected when KB active |
|---|---|
| `kbCallCount` | > 0 (number of HTTP calls to KB service) |
| `kbCallTotalMs` | > 0 (total latency in ms) |
| `kbCallErrorCount` | 0 when KB is healthy |

---

# Phase 9 — Rollout and Testing

## Integration test verification

```bash
# From service/ directory
cd service && sh scripts/run-integration-tests-docker.sh
# Expected: All integration tests pass including 5 new KB scenarios

# Or run just the KB integration tests in test-mode:
TEST_MODE=true node --test test/integration/kb_enhance.integration.test.js
# Expected: 5 tests pass (they skip when TEST_MODE is not true)
```

## Code verification

Confirm new files exist:
```bash
ls service/test_support/kb_mock.js
ls service/test/integration/kb_enhance.integration.test.js
ls service/docs/jain_kb_service/manual_testing.md
```

Confirm kb mock has all required exports:
```bash
grep -n "createKbMock\|setBehavior\|setAllError\|callCountFor\|reset\|start\|stop" service/test_support/kb_mock.js
# Expected: all methods present
```

Confirm test provider has KB triggers:
```bash
grep -n "JAIN_QUESTION\|DIRECT_RETRIEVAL_QUESTION" service/src/testing/test_provider_factory.js
# Expected: 2 trigger strings and their response blocks
```

Confirm debug endpoint in server.js:
```bash
grep -n "v1/debug/kb-stats\|kbGlobalStats\|recordGlobalKbStat" service/src/server.js
# Expected: endpoint handler, Map declaration, and record function
```

## Scenario-by-scenario verification (manual, TEST_MODE=true)

### Scenario 1: KB enabled, basic jain question
```bash
TEST_MODE=true KB_ENHANCE_ENABLED=true KB_SERVICE_BASE_URL=<kb_mock_url> \
  node --test test/integration/kb_enhance.integration.test.js
```
Expected: topics_match and graphrag called (check kb-stats debug endpoint), answer returned.

### Scenario 2: KB down, graceful degradation
Set KB mock to return 500. Expected: answer returned despite all KB errors, kbCallErrorCount > 0.

### Scenario 3: Master flag off
`kbEnhanceEnabled: false`. Expected: 0 KB calls, kbEnhanceEnabled=false in debug stats.

### Scenario 4: Per-phase flags
`KB_ENHANCE_DEFINITIONS=false KB_ENHANCE_KEYWORD_RESOLVE=false`. Expected: keyword_resolve_batch not called, topics_match still called.

### Scenario 5: Backward compat old agent API
Test external API returns `guided_results: []`. Expected: valid answer, no guided passages section causing errors.

## Log lines to monitor (Phases 8 & 9)

| Log message | Level | When |
|-------------|-------|------|
| `service_start` | info | Now includes `kbPhaseFlags` object when KB enabled |
| `kb_topic_match_injected` | info | Now includes `kbCallCount`, `kbCallTotalMs`, `kbCallErrorCount` |
| `kb_api_response` | info | Contains `path` (endpoint), `durationMs` (latency), `status`, `requestId` |
| `kb_api_failed` | warn | Contains `path`, `status`, `requestId` |
