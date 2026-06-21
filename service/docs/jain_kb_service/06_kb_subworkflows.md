# Phase 6 (chat) — KB Sub-workflow Dispatch

Step1 now returns a `kb_subworkflows[]` array (Phase 1). Each entry
declares a structural query that the orchestrator dispatches **in parallel
with** the main workflow's retrieval. Results are merged into Step2 context
under a dedicated section.

## Sub-workflows

### `direct_retrieval`

Use: "`shastra` की `N`th गाथा बताओ", "…की संस्कृत/भावार्थ समझाओ".

Step1 schema:
```json
{
  "name": "direct_retrieval",
  "shastra": "समयसार",                       // user-supplied form; canonicalized via kb.shastras(fuzzy)
  "gatha_number": 6,
  "want": ["sanskrit", "bhaavarth", "teeka"]     // any subset of: prakrit, sanskrit, anyavaarth, bhaavarth, teeka
}
```

Dispatch:
1. `kb.shastras({ q: shastra, fuzzy: true, limit: 1 })` → canonical
   `natural_key`.
2. `kb.gathaDetail({ shastra: natural_key, number: gatha_number })`
   (core-service `GET /v1/gathas?shastra=&number=`).
3. Project `want[]` fields only into context.

### `search_topic_in_shastra`

Use: "`shastra` की `N`th गाथा में किन-किन विषयों का वर्णन आया है".

Step1 schema:
```json
{
  "name": "search_topic_in_shastra",
  "shastra": "समयसार",
  "gatha_number": 6,                 // optional; omit for whole-shastra topics
  "limit": 25
}
```

Dispatch:
1. Canonicalize shastra (as above).
2. `kb.topicsInShastra({ shastra_natural_key, gatha_number?, limit })`.
3. Project topics + mention_count into context.

### `search_shastra_for_topics`

Use: "`topic` का वर्णन कोन-कोन से शास्त्रों और गाथाओं में आया है?"

Step1 schema:
```json
{
  "name": "search_shastra_for_topics",
  "topic_keywords": ["द्रव्य", "स्वतंत्रता"],   // or
  "topic_natural_key": "द्रव्य/स्वतंत्रता",     // optional direct
  "limit_shastras": 10,
  "limit_gathas_per_shastra": 10
}
```

Dispatch:
1. If `topic_natural_key` absent: `kb.topicsMatch({ keywords:
   topic_keywords, limit: 1 })` → take top.
2. `kb.shastrasForTopic({ topic_natural_key, … })`.
3. Project shastra + gathas tuples into context.

## Orchestration

- All `kb_subworkflows[]` entries fire **in parallel** with each other and
  with the main workflow's retrieval (`Promise.all`).
- Cap total sub-workflow calls: `KB_SUBWORKFLOWS_MAX=4` (env).
- Each sub-workflow has a hard timeout (`KB_SUBWORKFLOW_TIMEOUT_MS=10000`);
  on timeout, the entry is dropped from Step2 context with a warning.

## Step2 context layout

Append a new section after Phase 3 / Phase 4 sections:

```
### KB Sub-workflow Results

[direct_retrieval] Samaysaar gatha 6:
  prakrit: …
  sanskrit: …
  bhaavarth: …

[search_topic_in_shastra] Samaysaar gatha 6 topics:
  - द्रव्य स्वतंत्रता (3)
  - …

[search_shastra_for_topics] topic = द्रव्य स्वतंत्रता:
  - Samaysaar: gathas 6, 49
  - Pravachansaar: gatha 12
```

## Workflow guideline files

For each main workflow, add a short paragraph to its
`workflow_answering_guidelines/<workflow>.md` describing how to use the
sub-workflow section when present (briefly: prefer canonical gatha text
over excerpts; cite using shastra + gatha number).

## Code changes

- `src/kb_api/client.js`: `gathaDetail()`, `topicsInShastra()`,
  `shastrasForTopic()`.
- `src/orchestrator/kb_subworkflows.js`: dispatch table by name + parallel
  runner + cap/timeout.
- `src/orchestrator/workflow_router.js`: call sub-workflow runner alongside
  main workflow; pass results into Step2 context builder.

## Tests

- One unit test per sub-workflow dispatcher (mock kb client).
- Integration: Step1 stub returns each sub-workflow shape; full pipeline
  emits the expected Step2 section.
- Timeout test: slow kb call → section omitted, warning logged.
- Cap test: more than `KB_SUBWORKFLOWS_MAX` entries → only first N fired.

## DoD

- [x] Three sub-workflows dispatchable in parallel (`direct_retrieval`, `search_topic_in_shastra`, `search_shastra_for_topics` via `Promise.all` in `runKbSubworkflows`).
- [x] Step2 context section rendered (`formatKbSubworkflowsContext` produces `### KB Sub-workflow Results` section).
- [x] Cap and timeout honoured (`KB_SUBWORKFLOWS_MAX` caps entries before dispatch; `KB_SUBWORKFLOW_TIMEOUT_MS` races each call with a hard timeout).
- [x] Workflow guidelines updated (4 workflow guideline files in `prompts_v2/workflow_answering_guidelines/` updated).
