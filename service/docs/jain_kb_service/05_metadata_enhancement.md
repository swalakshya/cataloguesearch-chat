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
- shastra: समयसार (nk=समयसार, sim=0.78)
- author:  कुंदकुंदाचार्य (nk=कुंदकुंदाचार्य, sim=0.71)

### CatalogueSearch Metadata Options (always in english)
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

- [x] `kb.shastras` / `kb.authors` / `kb.teekas` wired with fuzzy (GET `/v1/shastras`, `/v1/authors`, `/v1/teekas` on `coreBaseUrl`).
- [x] Two-section context for metadata workflow (`### KB Metadata Matches` prepended before CatalogueSearch sources). Note: `### CatalogueSearch Metadata Options` label deferred; sections are still clearly separated.
- [x] Non-metadata workflows include the same section when hints present (fired in `server.js` in parallel with retrieval workflow).
- [x] Failures degrade silently (three levels of `.catch`: per-hint, outer metadata module, pipeline-level `server.js`).
