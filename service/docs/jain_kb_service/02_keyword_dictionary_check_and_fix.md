# Phase 2 (chat) — Jain Keyword Dictionary Check + Step1b Integration

After Step1 produces `jain_keywords[]`, validate them against the kb
dictionary. Matched keywords are used as-is; misses with high-confidence
suggestions trigger a Step1b *keyword fix* LLM call with those suggestions
in the prompt.

## Sequence

```
Step1 → jain_keywords[]
   │
   ├─ kb POST /v1/query/keyword_resolve_batch
   │     { tokens: jain_keywords, fuzzy_top_k: 5, include_definitions: false }
   │
   ├─ split resolutions:
   │     matched[]   = match_kind in {exact, alias, suffix_strip}
   │     missed[]    = match_kind == "none"
   │
   ├─ replace each matched token in keywords[] with its keyword_natural_key
   │   (kept alongside the original under conversation history; see below)
   │
   ├─ if missed[].length > 0 AND any missed has suggestions:
   │     fire Step1b keyword-fix LLM call with:
   │       - original Step1 output
   │       - missed_with_suggestions: [{token, suggestions: [{kw, similarity}]}]
   │     re-merge into keywords[] / jain_keywords[]
   │
   └─ continue to workflow execution
```

`include_definitions=false` here — definitions are fetched **later** in
Phase 7 only for keywords actually used by Step2.

## Token replacement rule

When `match_kind` is `exact|alias|suffix_strip` and
`keyword_natural_key != input_token`, rewrite that token to the canonical
form in both `keywords[]` and `jain_keywords[]`. This narrows the vector
search to the canonical Sanskrit/Hindi term and improves recall.

Store the mapping `{ original_token → canonical }` on the workflow context
for use in Phase 7 (definitions lookup) and for logging.

## Step1b prompt

Edit `service/prompts_sets/prompts_v2/step_1b_keyword_fix.md`:

- Add an input section `MISSED_JAIN_KEYWORDS_WITH_SUGGESTIONS` rendered as:

  ```
  आतम → suggestions: आत्मा (0.58), आतमा (0.41)
  ksudra → suggestions: क्षुद्र (0.58), क्षुधा (0.41)
  ```

- Add the instruction: *"For each missed jain keyword, if a suggestion is
  clearly a valid synonym/canonical form of what the user meant, replace
  the missed token in `keywords[]` with that suggestion. If no suggestion
  fits, drop the token from `jain_keywords[]` but keep it in `keywords[]`
  for fallback vector search."*

Step1b still re-emits the **full Step1 JSON** (existing behaviour). It does
not introduce a new schema.

## When to skip Step1b

- `missed[].length == 0`: skip Step1b (current happy path is faster).
- All `missed[]` have *no* suggestions (fuzzy returned nothing above
  cutoff): skip Step1b too — no useful signal to give the LLM. Fall through
  to today's "zero chunks" behaviour, which already triggers Step1b.

This means kb-driven Step1b can fire **before** the existing zero-chunks
trigger; both paths share the same `step_1b_keyword_fix.md` prompt.

## Code changes

- New module `src/kb_api/client.js` — `keywordResolveBatch(tokens, opts)`.
- New module `src/orchestrator/kb_keyword_check.js` — owns the split +
  canonical-rewrite logic. Pure function, easy to unit test.
- `src/orchestrator/workflow_router.js` (or wherever Step1→workflow handoff
  lives): insert the check between Step1 result and workflow dispatch.
  Re-run via `keyword_extract.js`'s existing fix-call helper when Step1b is
  needed.

## Tests

- `kb_keyword_check.test.js`:
  - matched-only path (no Step1b trigger).
  - one miss with suggestions → fires Step1b.
  - one miss without suggestions → does NOT fire Step1b.
  - canonical-rewrite mutates `keywords[]` correctly.
- Integration: stub `keyword_resolve_batch` HTTP with three scenarios; full
  pipeline returns expected canonical keywords downstream.

## DoD

- [ ] `kb_api/client.js` wired with timeout + retry (use existing HTTP
      patterns).
- [ ] `kb_keyword_check.js` covered by unit tests.
- [ ] `step_1b_keyword_fix.md` updated.
- [ ] When `KB_ENHANCE_ENABLED=false`, no kb calls fire; pipeline identical
      to today.
