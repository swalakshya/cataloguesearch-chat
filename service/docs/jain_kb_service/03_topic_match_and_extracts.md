# Phase 3 (chat) — Topic Match + Extract Injection

For every workflow that produces a `keywords[]` array (i.e. all except
`metadata_question_v1` and `greeting_message_v1`), call kb's two topic-match
endpoints in **parallel**, merge results by `topic_natural_key`, cap, and
attach the Hindi extracts to Step2 context.

## When to run

| Workflow | Run topic-match? | Keywords source |
|---|---|---|
| `basic_question_v1` | yes | `keywords[]` |
| `followup_question_v1` | yes | `keywords[]` + each `followup_keywords[].keywords` (one match call per set, merged) |
| `advanced_distinct_questions_v1` | yes | one call per query's `keywords[]` |
| `advanced_nested_questions_v1` | yes | one call for `main_query.keywords`, one per sub-query |
| `metadata_question_v1` | no | — |
| `greeting_message_v1` | no | — |

## Parallel kb calls

For each keyword set `K`:

```
Promise.all([
  kb.topicsMatch({ keywords: K, limit: KB_TOPIC_MATCH_LIMIT,
                   include_extracts: true, include_references: true }),
  kb.graphrag({ tokens: K, limit: KB_GRAPHRAG_LIMIT,
                include_extracts: true, include_neighbors: true,
                include_references: true })
])
```

## Merge rule

```
byKey = new Map<topic_natural_key, MergedTopic>()
for hit in topicsMatchResults: byKey.set(hit.topic_natural_key, hit)
for hit in graphragResults:
  if byKey.has(hit.topic_natural_key):
    merge: keep higher score; union extracts_hi (by block_index);
           union references; attach hit.neighbors
  else:
    byKey.set(hit.topic_natural_key, hit)
sort by score DESC
take top KB_TOPIC_MERGE_LIMIT
```

Default caps (overridable via env, see Phase 8):
- `KB_TOPIC_MATCH_LIMIT=5`
- `KB_GRAPHRAG_LIMIT=5`
- `KB_TOPIC_MERGE_LIMIT=5`

## Failure handling

- If either kb call fails → log warning, proceed with whichever succeeded.
- If both fail → log warning, proceed with vector RAG only. **Never** fail
  the user request because of a kb hiccup.

## Step2 context injection

Add a new section to `step_2_answer_synthesis.md` (insert above the existing
chunks section):

```
### KB Topics (Hindi extracts, closest first)
- topic: <display_text_hi> (path: <ancestors_hi> / <display_text_hi>)
  extract: <text_hi truncated>
  refs: shastra=<sn>, gatha=<n>, page=<p>
- …
```

Token-budget: extracts truncated to 1500 chars (kb already enforces this on
its side — Phase 5 of kb specs).

The same merged topic list also feeds:
- Phase 4 (guided filters extraction from `references[]`).
- Phase 7 (collect `matched_seed_keywords` for definition lookup).

## Code changes

- `src/kb_api/client.js`: `topicsMatch()`, `graphrag()`.
- New `src/orchestrator/kb_topic_match.js`: pure-function merger.
- `src/orchestrator/answer_synthesis.js`: include merged topics in context
  builder when present.
- `src/utils/chunk.js` (or a new `kb_context.js`): formatter for the new
  section.

## Tests

- Merge unit tests: overlap, no-overlap, graphrag wins on tie.
- Per-workflow: parallel calls happen for each keyword set (mock asserts
  call count).
- Step2 context formatter snapshot test.
- Failure-mode: both kb calls reject → synthesis still runs.

## DoD

- [ ] Two kb calls fire in parallel per keyword set.
- [ ] Merged topics passed to Step2 context.
- [ ] Failures degrade gracefully.
- [ ] Caps configurable via env.
