# Phase 8 (chat) — Config, Envs, Caps

All new envs live in `src/config/kb_config.js` (new file). Per-model
overrides land in `src/config/model_config.js` `workflowOverrides` under a
new `kb` sub-object.

## Global flag

| Env | Default | Purpose |
|---|---|---|
| `KB_ENHANCE_ENABLED` | `false` | Master switch. When false, no kb call fires. |

Phase sub-flags (all default to `KB_ENHANCE_ENABLED`):

| Env | Phase |
|---|---|
| `KB_ENHANCE_KEYWORD_RESOLVE` | 2 |
| `KB_ENHANCE_TOPIC_MATCH` | 3 |
| `KB_ENHANCE_GUIDED_FILTERS` | 4 |
| `KB_ENHANCE_METADATA` | 5 |
| `KB_ENHANCE_SUBWORKFLOWS` | 6 |
| `KB_ENHANCE_DEFINITIONS` | 7 |

## Endpoints + timeouts

```
KB_SERVICE_BASE_URL=http://localhost:8004
KB_DATA_SERVICE_BASE_URL=http://localhost:8002
KB_METADATA_SERVICE_BASE_URL=http://localhost:8001
KB_REQUEST_TIMEOUT_SEC=15
KB_REQUEST_MAX_RETRIES=1
```

## Caps & limits

| Env | Default | Used by |
|---|---|---|
| `KB_KEYWORD_RESOLVE_MAX_TOKENS` | 32 | Phase 2 batched resolve |
| `KB_KEYWORD_FUZZY_TOP_K` | 5 | Phase 2 |
| `KB_KEYWORD_FUZZY_MIN_SIM` | 0.35 | Phase 2 |
| `KB_TOPIC_MATCH_LIMIT` | 5 | Phase 3 |
| `KB_GRAPHRAG_LIMIT` | 5 | Phase 3 |
| `KB_TOPIC_MERGE_LIMIT` | 5 | Phase 3 |
| `KB_TOPIC_EXTRACT_TRUNCATE_CHARS` | 1500 | Phase 3 (kb-side enforced; doc-only here) |
| `KB_GUIDED_FILTERS_CAP` | 5 | Phase 4 |
| `KB_METADATA_FUZZY_LIMIT` | 5 | Phase 5 |
| `KB_METADATA_FUZZY_MIN_SIM` | 0.25 | Phase 5 |
| `KB_SUBWORKFLOWS_MAX` | 4 | Phase 6 |
| `KB_SUBWORKFLOW_TIMEOUT_MS` | 10000 | Phase 6 |
| `KB_DEFINITIONS_MAX_KEYWORDS` | 15 | Phase 7 |
| `KB_DEFINITIONS_PER_KEYWORD` | 0 (=all) | Phase 7 |

## Per-model overrides

Example in `model_config.js`:

```js
const MODEL_ROUTING_CONFIG = {
  models: [
    { id: "gpt-4o", provider: "openai", priority: 3,
      workflowOverrides: {
        kb: {
          topic_match_limit: 3,
          graphrag_limit: 3,
          topic_merge_limit: 4,
          definitions_max_keywords: 10,
        }
      }
    },
  ],
};
```

Merge order: env defaults → `workflowDefaults.kb` → `workflowOverrides.kb`.

## Logging

Every kb call records, in structured logs:

```
{ kb_endpoint, request_payload_summary, response_summary, latency_ms,
  status, tool_trace_id }
```

`response_summary` is shaped per endpoint (e.g. counts of
resolutions/topics/etc.) — never includes full text bodies.

## DoD

- [ ] `kb_config.js` exposes all envs with defaults.
- [ ] Master + per-phase flags respected at call sites.
- [ ] Per-model overrides applied during routing.
- [ ] Logging shape verified by test.
