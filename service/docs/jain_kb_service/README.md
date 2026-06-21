# Jain KB Service — Agent Wiki

This document is the single entry point for any agent working with the Jain KB Service integration in `cataloguesearch-chat/service/`. Read this before touching any KB-related code.

---

## What is it?

The Jain KB Service integration enriches the existing chat pipeline with a GraphRAG-powered knowledge base of Jain scripture (shastras, topics, gathas, authors). It adds five parallel enrichment streams that inject additional context into the Step2 LLM answer synthesis call.

The KB service itself lives in `dictionary-and-metadata-service/`. This doc covers only the `cataloguesearch-chat/service/` side.

---

## Architecture: Enhanced Pipeline

```
Step1 (keyword extract + jain classification + kb_subworkflows detection)
  │
  ├─ Phase 2: KB keyword resolve → canonical rewrite + Step1b suggestions
  ├─ Phase 3: KB topic match (topics_match anchor → topic_neighbors expand) → topic extracts + references
  ├─ Phase 5: KB metadata fuzzy match (shastras/authors) → metadata context
  ├─ Phase 6: KB sub-workflow dispatch (direct_retrieval, search_topic_in_shastra, search_shastra_for_topics)
  ├─ Phase 7: KB keyword definitions → definition context
  │
  ├─ workflow → external_search (with guided_filters from Phase 4) → chunks
  │
  └─ Step2 context (assembled in order):
        kbMetadataSection
        kbDefinitionsSection
        kbTopicsSection
        kbSubworkflowsSection
        chunksContext (main chunks)
        guidedSection (Phase 4 filtered chunks)
```

**Phase 3 is sequential before the workflow** (needed to derive `mergedTopics` for guided filters). All other KB phases run in parallel with the external search workflow.

---

## Key Files

### Config & Client

| File | Purpose |
|------|---------|
| `src/config/kb_config.js` | Master + per-phase env flags, endpoint URLs, all cap defaults, `getKbWorkflowConfig()` for per-model overrides |
| `src/kb_api/client.js` | `KbApiClient` class — all HTTP calls to query-service and core-service with logging + `onCallComplete` stats callback |

### Orchestrators (one per phase)

| File | Phase | Purpose |
|------|-------|---------|
| `src/orchestrator/kb_keyword_check.js` | 2 | Resolve jain keywords against KB dictionary; canonical rewrite; gate Step1b |
| `src/orchestrator/kb_topic_match.js` | 3 | `topicsMatch` anchor → `topicNeighbors` expand per keyword set; format context section |
| `src/orchestrator/kb_guided_filters.js` | 4 | Derive guided filters from topic references; used inside each search workflow |
| `src/orchestrator/kb_metadata_match.js` | 5 | Fuzzy shastra/author lookup; format metadata section |
| `src/orchestrator/kb_subworkflows.js` | 6 | Dispatch `direct_retrieval`/`search_topic_in_shastra`/`search_shastra_for_topics`; format context section |
| `src/orchestrator/kb_definitions.js` | 7 | Collect jain keywords used; batch fetch definitions; format definitions section |

### Schema & Prompts

| File | Purpose |
|------|---------|
| `src/config/keyword_schema.js` | `jain_keywords`, `normal_keywords`, `kb_subworkflows`, `kb_entities` added to Step1 JSON schema |
| `prompts_sets/prompts_v2/step_1_keyword_extract_and_classification.md` | Jain classification rules + KB sub-workflow catalog |
| `prompts_sets/prompts_v2/step_1b_keyword_fix.md` | `<MISSED_JAIN_KEYWORDS_WITH_SUGGESTIONS>` slot |
| `prompts_sets/prompts_v2/workflow_answering_guidelines/*.md` | `## KB Sub-workflow Results` section |

### Tests

| File | Tests |
|------|-------|
| `test/config/kb_config.test.js` | Phase flags, endpoints, caps, `getKbWorkflowConfig` merge, `onCallComplete` callbacks |
| `test/kb_api/client.test.js` | All client methods including real-shape contract tests |
| `test/orchestrator/kb_keyword_check.test.js` | Resolve/rewrite/Step1b gate |
| `test/orchestrator/kb_topic_match.test.js` | `extractKeywordSets`, `attachNeighbors`, `formatKbTopicsContext`, `runKbTopicMatch` |
| `test/orchestrator/kb_guided_filters.test.js` | `deriveGuidedFilters` cap/dedup/field-mapping |
| `test/orchestrator/kb_metadata_match.test.js` | `fetchKbMetadataMatches`, `buildKbMetadataSection` |
| `test/orchestrator/kb_subworkflows.test.js` | `runKbSubworkflows`, `formatKbSubworkflowsContext` |
| `test/orchestrator/kb_definitions.test.js` | `collectUsedJainKeywords`, `fetchKbDefinitions`, `formatKbDefinitionsContext` |
| `test/integration/kb_enhance.integration.test.js` | 12 end-to-end scenarios (TEST_MODE=true only) |

---

## Environment Variables

All KB behavior is controlled by env vars. **Default: everything off** (`KB_ENHANCE_ENABLED=false`).

### Master toggle

| Var | Default | Description |
|-----|---------|-------------|
| `KB_ENHANCE_ENABLED` | `false` | Master switch. All KB phases no-op when false |

### Per-phase flags (only checked when master is on)

| Var | Default | Phase |
|-----|---------|-------|
| `KB_ENHANCE_KEYWORD_RESOLVE` | `true` | Phase 2 — keyword resolution |
| `KB_ENHANCE_TOPIC_MATCH` | `true` | Phase 3 — topic match + neighbors |
| `KB_ENHANCE_GUIDED_FILTERS` | `true` | Phase 4 — guided filter search calls |
| `KB_ENHANCE_METADATA` | `true` | Phase 5 — metadata fuzzy match |
| `KB_ENHANCE_SUBWORKFLOWS` | `true` | Phase 6 — sub-workflow dispatch |
| `KB_ENHANCE_DEFINITIONS` | `true` | Phase 7 — keyword definitions |

### Endpoints

| Var | Default | Points to |
|-----|---------|-----------|
| `KB_SERVICE_BASE_URL` | `http://localhost:8004` | query-service (topics_match, topic_neighbors, graphrag, keyword_resolve_batch, topics_in_shastra, shastras_for_topic) |
| `KB_CORE_SERVICE_BASE_URL` | `http://localhost:8001` | core-service (shastras, authors, teekas, gathaDetail) |
| `KB_REQUEST_TIMEOUT_SEC` | `10` | Default timeout for KB API calls |

### Caps

| Var | Default | Description |
|-----|---------|-------------|
| `KB_TOPIC_MATCH_LIMIT` | `5` | Max topics per `topicsMatch` call |
| `KB_TOPIC_NEIGHBORS_LIMIT` | `10` | Max neighbors per `topicNeighbors` call |
| `KB_TOPIC_MERGE_LIMIT` | `5` | Max topics after dedup across keyword sets |
| `KB_GUIDED_FILTERS_CAP` | `5` | Max guided filter calls per request |
| `KB_GUIDED_PAGE_SIZE` | `3` | Chunks per guided filter search |
| `KB_SUBWORKFLOWS_MAX` | `4` | Max sub-workflows executed per request |
| `KB_SUBWORKFLOW_TIMEOUT_MS` | `10000` | Per-sub-workflow timeout |
| `KB_DEFINITIONS_PER_KEYWORD` | `0` | Definitions returned per keyword (0=all) |
| `KB_DEFINITIONS_MAX_KEYWORDS` | `15` | Max keywords sent to definition lookup |

---

## KB API Endpoints Reference

### query-service (`KB_SERVICE_BASE_URL`, port 8004)

| Method | Path | Used by |
|--------|------|---------|
| `POST` | `/v1/query/keyword_resolve_batch` | Phase 2, Phase 7 |
| `POST` | `/v1/query/topics_match` | Phase 3, Phase 6 (sub-workflow fallback) |
| `POST` | `/v1/query/topic_neighbors` | Phase 3 |
| `POST` | `/v1/query/graphrag` | `KbApiClient` only (not called by current phases) |
| `POST` | `/v1/query/topics_in_shastra` | Phase 6 `search_topic_in_shastra` |
| `POST` | `/v1/query/shastras_for_topic` | Phase 6 `search_shastra_for_topics` |

### core-service (`KB_CORE_SERVICE_BASE_URL`, port 8001)

| Method | Path | Used by |
|--------|------|---------|
| `GET` | `/v1/shastras` | Phase 5, Phase 6 (shastra canonicalization) |
| `GET` | `/v1/authors` | Phase 5 |
| `GET` | `/v1/teekas` | Phase 5 (client wired, not yet called in orchestrator) |
| `GET` | `/v1/gathas` | Phase 6 `direct_retrieval` (non-functional — see known limitation) |

---

## Important: Response Shape Contracts

These shapes bit the integration during live verification. Get them right.

**`/v1/shastras`, `/v1/authors`, `/v1/teekas`** return `{items: [...], pagination}` where display names are localized arrays (`title[]` for shastras/teekas, `display_name[]` for authors). The client normalizes these via `normalizeResourceItems()` → flat array with a derived `name` field (Hindi entry of the localized array).

**`/v1/query/topic_neighbors`** returns `{neighbors_by_anchor: [{anchor_topic_natural_key, related_topics, ...}]}` — a **list**, not an object map. The client converts it to an object map keyed by `anchor_topic_natural_key`.

---

## Step1 Schema Extensions

The following fields are added to the LLM keyword extraction output:

```json
{
  "jain_keywords": ["आत्मा", "द्रव्य"],
  "normal_keywords": ["संबंध", "भेद"],
  "kb_subworkflows": [
    {
      "name": "direct_retrieval",
      "shastra": "समयसार",
      "gatha_number": 6,
      "want": ["sanskrit", "bhaavarth"]
    }
  ],
  "kb_entities": {
    "shastra_hints": ["समयसार"],
    "author_hints": []
  }
}
```

**Fallback**: if the LLM omits `jain_keywords`/`normal_keywords`, `applyJainPartitionDefaults()` in `keyword_extract.js` derives them — any keyword matching `/[ऀ-ॿ]/` (Devanagari) is treated as `jain`.

**Sub-workflow validation**: `stripUnknownSubworkflows()` removes any entry whose `name` is not one of the three allowed values.

---

## Sub-workflow Types (Phase 6)

| Name | Description | Key fields |
|------|-------------|------------|
| `direct_retrieval` | Fetch specific gatha content | `shastra`, `gatha_number`, `want[]` — **currently non-functional** (see known limitation) |
| `search_topic_in_shastra` | List topics within a shastra (optionally near a gatha) | `shastra`, `topic`, `gatha_number?` |
| `search_shastra_for_topics` | List shastras that cover a topic | `shastra?`, `topic` |

The dispatcher canonicalizes shastras via `GET /v1/shastras?q=&fuzzy=true` before calling the data endpoint. For `search_shastra_for_topics`, if `topic` isn't a natural key, it's resolved via `topics_match` first.

---

## Graceful Degradation

Every KB phase degrades gracefully:
- Any HTTP error or timeout → log warn → return empty string / original input
- `KB_ENHANCE_ENABLED=false` → `kbApiClient` is `null` → all KB orchestrators return `""` / `[]` immediately
- KB service fully down → chat answer still returned from main chunks

---

## Observability

The `kb_topic_match_injected` structured log line (emitted after context assembly) includes:

| Field | Description |
|-------|-------------|
| `kbTopicCount` | Number of topics injected |
| `kbDefinitionsSectionPresent` | Whether definition section was added |
| `kbMetadataSectionPresent` | Whether metadata section was added |
| `kbSubworkflowsCount` | Number of sub-workflow results |
| `kbCallCount` | Total KB API calls this request |
| `kbCallTotalMs` | Cumulative KB call time |
| `kbCallErrorCount` | Failed KB calls |

**Debug endpoint** (TEST_MODE only): `GET /v1/debug/kb-stats` — per-endpoint call counters since server start. Reset via `POST /v1/test/reset`.

---

## Testing

```bash
# Unit tests
cd service && sh scripts/run-tests-docker.sh

# Integration tests (requires TEST_MODE=true + KB mock)
cd service && sh scripts/run-integration-tests-docker.sh
```

Integration tests use an in-process Express mock (`test/test_support/kb_mock.js`) — not a real KB service. Each scenario sets mock behavior via `kb.setBehavior(endpoint, {...})` and asserts call counts + synthesis context via `GET /v1/test/last-synthesis-context`.

---

## Known Limitations

1. **`direct_retrieval` sub-workflow is non-functional** against the live core-service. `GET /v1/gathas` does not support `(shastra, gatha_number)` lookup — gatha identity requires a compound natural key path. Needs a new query-service endpoint. The other two sub-workflows work.

2. **`kbModelConfig` per-model cap overrides not yet propagated** to orchestrator functions. `getKbWorkflowConfig(modelId)` is computed per-request in `server.js` but orchestrators still read from `process.env` directly. The infrastructure is in place; wiring it to function call sites is the follow-up task.

3. **`teekas` not called in Phase 5** — `kb_entities` has no `teeka_hints` field yet. The client method is implemented and tested.

---

## Phase Spec Docs

For detailed specs including prompt changes, JSON schemas, and API contracts:

- [00_overview.md](00_overview.md) — pipeline diagram, phase list
- [01_step1_jain_keyword_classification.md](01_step1_jain_keyword_classification.md) — Step1 schema extension
- [02_keyword_dictionary_check_and_fix.md](02_keyword_dictionary_check_and_fix.md) — keyword resolve + Step1b integration
- [03a_sequential_topic_anchor_expand.md](03a_sequential_topic_anchor_expand.md) — topic match + neighbors (active spec; 03 superseded)
- [03b_two_hop_related_extracts.md](03b_two_hop_related_extracts.md) — 2-hop related topic extracts + related keyword definitions, nested in Step2 (extends 03a; needs backend [08](../../../../dictionary-and-metadata-service/docs/design/query_engine/08_content_gated_topic_neighbors.md))
- [04_guided_filters_in_agent_api.md](04_guided_filters_in_agent_api.md) — guided filter search calls
- [05_metadata_enhancement.md](05_metadata_enhancement.md) — fuzzy shastra/author match
- [06_kb_subworkflows.md](06_kb_subworkflows.md) — sub-workflow dispatch
- [07_definitions_in_step2_context.md](07_definitions_in_step2_context.md) — keyword definitions
- [08_config_envs_and_caps.md](08_config_envs_and_caps.md) — all env vars + per-model config
- [09_rollout_and_testing.md](09_rollout_and_testing.md) — integration test strategy
- [initial_implementation_notes.md](initial_implementation_notes.md) — implementation notes, bugs found/fixed, deviations from spec per phase
- [manual_testing.md](manual_testing.md) — curl-based manual test scenarios
