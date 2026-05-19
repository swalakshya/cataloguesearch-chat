# Phase 5 (chat) — Metadata Enhancement (parallel kb + cataloguesearch)

Today `metadata_question_v1` uses only `external_get_metadata_options`.
Enhancement: when `kb_entities.shastra_hints[]` or `author_hints[]` are
present (from Step1), call kb-service in parallel and surface both lists to
Step2 labelled separately.

## Sequence (inside `metadata_question_v1` and any workflow where
`kb_entities.*_hints` is non-empty)

```
Promise.all([
  agent_api.get_metadata_options({ language, content_type }),
  kb.shastras({ q: hint, fuzzy: true, limit: 5 })    // per hint
  kb.authors({  q: hint, fuzzy: true, limit: 5 })    // per hint
])
```

## Step2 context layout

Replace the current metadata-only context with two clearly labelled
sections:

```
### KB Metadata Matches (closest first)
- shastra: समयसार (nk=samaysaar, sim=0.78)
- author:  Pandit Jaychand Chhabbra (nk=jaychand_chhabbra, sim=0.71)

### CatalogueSearch Metadata Options
{ granth: "Samaysaar", author: "Pandit Jaychand Chhabbra", anuyog: "Dravyanuyog" }
…
```

The two lists are presented side-by-side; the LLM reconciles. We do **not**
filter cataloguesearch options by kb (per the user's "Parallel; supply both
lists" decision). This preserves cataloguesearch's authority over its own
catalogue while letting the LLM benefit from kb canonicalization.

## Code changes

- `src/kb_api/client.js`: `shastras({q, fuzzy, limit})`, `authors({…})`,
  `teekas({…})`.
- `src/orchestrator/workflows/metadata_question_v1.js`: parallel calls + new
  context section.
- For non-metadata workflows that also carry `kb_entities.*_hints`: fire the
  same kb metadata calls in parallel with the existing pipeline and append
  results to Step2 context under the same heading.

## Failure handling

kb metadata calls are non-critical: log and proceed without them.

## Tests

- `metadata_question_v1` with shastra_hint: both lists appear in context.
- Workflow without hints: no kb metadata call.
- kb returns no fuzzy match: section omitted (no empty heading).
- kb call timeout: workflow still succeeds.

## DoD

- [ ] `kb.shastras` / `kb.authors` / `kb.teekas` wired with fuzzy.
- [ ] Two-section context for metadata workflow.
- [ ] Non-metadata workflows include the same section when hints present.
- [ ] Failures degrade silently.
