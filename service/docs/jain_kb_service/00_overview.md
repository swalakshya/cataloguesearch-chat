# Jain KB Service Integration — Overview & Scope

This folder specifies the `cataloguesearch-chat` (`service/`) side of the
GraphRAG enhancement. kb-service side lives in
`dictionary-and-metadata-service/docs/query_engine/`.

Each Phase doc (`01_*`…`09_*`) is sized so a single agent can land it in one
context window without delegating.

---

## Where each enhancement lives in the existing pipeline

Today's pipeline (see `service/docs/design.md`):

```
Step1 (keyword extract) → workflow → external_search/navigate → Step1b? → Step2 (synthesis)
```

After this change:

```
Step1 (keyword extract + jain classification + kb_subworkflows)
  │
  ├─ Phase 2: kb keyword resolve (validate jain keywords)        → may trigger Step1b with suggestions
  ├─ Phase 3: kb topic match (parallel: topics_match + graphrag) → topic extracts + references
  ├─ Phase 6: kb sub-workflow dispatch (direct_retrieval, etc.)
  ├─ Phase 5: kb metadata fuzzy (parallel with external_get_metadata_options)
  │
  ├─ workflow → external_search (now with guided_filters) → Phase 4
  │
  └─ Step2 (synthesis) — context now includes:
        • cataloguesearch chunks (existing)
        • guided_results from external_search (Phase 4)
        • topic extracts (Hindi only) (Phase 3)
        • keyword definitions (Hindi only) (Phase 7)
        • kb metadata matches (Phase 5)
        • kb sub-workflow payloads (Phase 6)
```

---

## Phase docs

1. `01_step1_jain_keyword_classification.md` — extend Step1 JSON schema
2. `02_keyword_dictionary_check_and_fix.md` — call kb resolve; integrate with Step1b
3. `03_topic_match_and_extracts.md` — parallel topics_match + graphrag; merge by natural_key
4. `04_guided_filters_in_agent_api.md` — derive guided_filters from topic refs; updated agent API contract
5. `05_metadata_enhancement.md` — kb metadata + cataloguesearch options in parallel
6. `06_kb_subworkflows.md` — direct_retrieval / search_shastra_for_topics / search_topic_in_shastra
7. `07_definitions_in_step2_context.md` — Hindi definitions for used jain keywords
8. `08_config_envs_and_caps.md` — all new envs, defaults, and per-workflow overrides
9. `09_rollout_and_testing.md` — feature flags, golden chat sessions, Docker integration tests

## kb-service base URL

```
KB_SERVICE_BASE_URL=http://localhost:8004   # query-service
KB_DATA_SERVICE_BASE_URL=http://localhost:8002
KB_METADATA_SERVICE_BASE_URL=http://localhost:8001
KB_NAVIGATION_SERVICE_BASE_URL=http://localhost:8003   # not used in v1
KB_REQUEST_TIMEOUT_SEC=15
```

## Shared HTTP client

Add `src/kb_api/client.js` with one function per kb endpoint used here. Keep
it in the same style as `src/agent_api/client.js`. Generate types from kb
OpenAPI when available.

## Rollout principle

A single env flag `KB_ENHANCE_ENABLED` gates **all** kb calls. When false,
the pipeline behaves exactly as today. Phase 9 details per-phase sub-flags
for safe staged rollout.

## Non-goals

- No embedding/vector calls in chat (kb is vectorless v1).
- No changes to session storage, model routing, or Gujarati search mode.
- No new LLM steps (kb sub-workflows are *additive* to the existing Step1
  output; no extra LLM round-trip in v1).
