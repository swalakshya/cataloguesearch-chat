# Phase 7 (chat) — Jain Keyword Definitions in Step2 Context

For each jain keyword that actually ends up driving retrieval (post Phase 2
canonical rewrite), fetch its Hindi definitions from kb and inject them
into Step2.

## When

Inside every retrieval workflow, after kb topic-match (Phase 3) and before
Step2:

```
usedJainKeywords = union of:
  - canonical jain_keywords[] (post Phase 2 rewrite)
  - mergedTopics[*].matched_seed_keywords   // from Phase 3
```

Dedup, cap by `KB_DEFINITIONS_MAX_KEYWORDS=15`.

## Fetch

A single batched kb call:

```
kb.keywordResolveBatch({
  tokens: usedJainKeywords,
  include_definitions: true,
  definitions_per_keyword: KB_DEFINITIONS_PER_KEYWORD,  // 0 = all
  fuzzy_top_k: 0   // suggestions not needed here
})
```

Because Phase 2 already resolved these, this second call should be all
exact/alias/suffix matches and is cheap. Definitions are Hindi-only,
truncated to 1500 chars per block (kb-side guarantee).

## Step2 context layout

Insert above existing chunks (and above Phase 3 topic extracts):

```
### KB Definitions (Hindi)
- आत्मा (nk=आत्मा):
    1. <definition block 1>
    2. <definition block 2>
- द्रव्य (nk=द्रव्य):
    1. <…>
```

## Failure handling

If the batch call fails: log warning, omit the section. Never fail the
request.

## Code changes

- Reuse `kb_api/client.js::keywordResolveBatch`.
- New `src/orchestrator/kb_definitions.js`: takes `usedJainKeywords[]`,
  returns the formatted context block.
- `utils/chunk.js` (or new `kb_context.js`): renders the section.

## Tests

- Unit: dedup + cap.
- Unit: empty `usedJainKeywords` → no kb call, no section.
- Integration: end-to-end pipeline produces the section with golden
  definitions.

## DoD

- [ ] Definitions appear in Step2 prompt when applicable.
- [ ] Single batched kb call; no per-keyword fan-out.
- [ ] Cap and per-keyword limits honoured.
