# Phase 10 — Skip Topic Match (and Guided Filters) for Direct-Retrieval-Only Queries

## Problem

For pure direct-retrieval questions — e.g. *"samaysaar gatha 6 ki sanskrit teeka ko word by word samjhaiye hindi me"* — the Step1 LLM already emits a `direct_retrieval` sub-workflow (Phase 6) that returns the **exact** gatha content (prakrit / sanskrit / anyavaarth / bhaavarth / teeka). The answer can be synthesized entirely from that authoritative block plus the main external chunk search.

However, Phase 3 ([`runKbTopicMatch`](../../src/orchestrator/kb_topic_match.js)) still runs unconditionally whenever `KB_ENHANCE_TOPIC_MATCH` is on. It injects a large **"KB Topics"** section (topic extracts + 2-hop related extracts — see the live example in [03b_two_hop_related_extracts.md](03b_two_hop_related_extracts.md)). For a direct lookup this is pure noise: it bloats the Step2 context by thousands of tokens of unrelated topic extracts.

The downstream **guided filters** (Phase 4) are derived from `mergedTopics`, so they are also unnecessary for these queries.

## Goal

Let the Step1 LLM categorize a query as **direct-retrieval-only**. When it does, skip Phase 3 (topic match) and Phase 4 (guided filters). Everything else (main external search, Phase 5 metadata, Phase 6 sub-workflows, Phase 7 definitions) runs unchanged.

## Decisions (locked)

| Decision | Choice |
|----------|--------|
| Classification | **Hybrid, LLM-primary.** New boolean `direct_retrieval_only` in Step1 output. |
| Code fallback | When the field is **absent / null**, behave exactly as today (do NOT skip). No heuristic guessing. Skip only happens when the LLM **explicitly** sets `direct_retrieval_only: true`. |
| Phases skipped when `true` | Phase 3 (topic match) **and** Phase 4 (guided filters). |
| Main external search | **Always kept** — corroborating chunks (Sources 1..N) are still retrieved. |
| Phase 5 / 6 / 7 | **Unchanged** — metadata, sub-workflows, definitions still run. |
| Rollout | **On by default** under existing `KB_ENHANCE_ENABLED` + `KB_ENHANCE_TOPIC_MATCH`. **No new env flag.** |

### Classification rule for the LLM

- `direct_retrieval_only: true` **only** when the entire question is a verbatim/specific lookup of one or more named gathas (mool / अर्थ / भावार्थ / सारांश / टीका of *that* gatha) with **no** separate conceptual/exploratory sub-question.
- `direct_retrieval_only: false` (or null) when the question also asks to explore a concept, compare, or discuss a topic — even if it *also* names a gatha.

**Examples**

| Question | `direct_retrieval_only` | Why |
|----------|-------------------------|-----|
| "samaysaar gatha 6 ki sanskrit teeka word by word samjhaiye" | `true` | Pure verbatim lookup of one gatha. Topics not needed. |
| "samaysaar gatha 6 ka bhaavarth batao" | `true` | Pure lookup. |
| "samaysaar gatha 6 ka saaransh batao, **isme atma ki swatantrata ke vishay me kya kya kaha gaya hai**" | `false` | Combined: lookup **plus** a conceptual exploration → KB topics still needed. |
| "atma ki swatantrata par kya kaha gaya hai" | `false` | Pure exploratory; no direct_retrieval at all. |

## Implementation

### 1. Schema — add `direct_retrieval_only`

File: [`src/config/keyword_schema.js`](../../src/config/keyword_schema.js)

Add a nullable boolean property to **both** `KEYWORD_EXTRACTION_SCHEMA` and `KEYWORD_EXTRACTION_SCHEMA_GUJ_SEARCH`, and add it to each `required[]` array (OpenAI strict mode requires every declared property in `required`).

```js
// near jain_keywords / kb_subworkflows
direct_retrieval_only: { type: ["boolean", "null"] },
```

Add `"direct_retrieval_only"` to both `required` arrays.

> Place it adjacent to `kb_subworkflows` in `properties` for readability; order in `properties` is cosmetic, but the `required` array must include it.

### 2. Step1 prompt — instruct the LLM

File: [`prompts_sets/prompts_v2/step_1_keyword_extract_and_classification.md`](../../prompts_sets/prompts_v2/step_1_keyword_extract_and_classification.md)

- Add a numbered instruction (after item 10, "KB sub-workflows"):

  > 11) **Direct-retrieval-only flag**: Set `direct_retrieval_only: true` ONLY when the *entire* question is a specific lookup of one or more named gathas (their mool / अर्थ / भावार्थ / सारांश / टीका) with **no** separate conceptual or exploratory sub-question. If the question also asks to explore/compare/discuss a concept (even alongside a gatha lookup), set `direct_retrieval_only: false`. If unsure, set `false`.

- Add `"direct_retrieval_only": true|false` to the **OUTPUT JSON** base-fields block (around line 116, next to `kb_subworkflows`).

> Only the `prompts_v2` default needs editing. Model-specific `prompts_v2_[MODEL_ID]` roots inherit unless they override this file.

### 3. Defaults — keep behavior safe when field absent

File: [`src/orchestrator/keyword_extract.js`](../../src/orchestrator/keyword_extract.js)

Normalize the field so downstream code can read a strict boolean, defaulting to `false` (= do not skip) when missing/null:

```js
function applyDirectRetrievalDefault(parsed) {
  parsed.direct_retrieval_only = parsed.direct_retrieval_only === true;
  return parsed;
}
```

Call it alongside the existing `applyJainPartitionDefaults(parsed)` / `stripUnknownSubworkflows(parsed)` in `runKeywordExtraction`. Add `direct_retrieval_only` to the `keyword_extract_parsed` verbose log.

### 4. Gate Phase 3 + Phase 4 in the pipeline

File: [`src/server.js`](../../src/server.js) (around lines 920-929)

```js
const directRetrievalOnly = keywordResult.direct_retrieval_only === true;

const mergedTopics = (kbApiClient && kbPhaseFlags.topicMatch && !directRetrievalOnly)
  ? await runKbTopicMatch({ keywordResult, kbApiClient, requestId })
  : [];

// guided filters derive from mergedTopics; empty topics ⇒ no guided searches,
// but gate explicitly for clarity + logging.
const mergedTopicsForWorkflow =
  (kbPhaseFlags.guidedFilters && !directRetrievalOnly) ? mergedTopics : [];
```

Add a structured log when the skip fires:

```js
if (directRetrievalOnly) {
  log.info("kb_direct_retrieval_skip", {
    requestId,
    skipped: ["topic_match", "guided_filters"],
  });
}
```

> Phase 5 (metadata), Phase 6 (sub-workflows), Phase 7 (definitions) blocks below are **unchanged**. Note `collectUsedJainKeywords(keywordResult, mergedTopics)` will now receive `[]` for `mergedTopics` on direct-only queries — that is correct; definitions still cover keywords found directly in `keywordResult`.

### 5. Observability

Add `directRetrievalOnly` (boolean) to the existing `kb_topic_match_injected` structured log line so dashboards can measure how often the skip fires and the context savings. Document it in the README observability table.

## Tests (TDD — write failing first)

| File | New cases |
|------|-----------|
| [`test/orchestrator/keyword_extract.test.js`](../../test/orchestrator/keyword_extract.test.js) | `direct_retrieval_only` passes through when `true`; defaults to `false` when omitted/null. |
| [`test/integration/kb_enhance.integration.test.js`](../../test/integration/kb_enhance.integration.test.js) | (a) `direct_retrieval_only: true` ⇒ `topics_match`/`topic_neighbors` **not** called, no guided-filter searches, but `direct_retrieval` + main search still fire and KB Topics section absent from synthesis context. (b) Combined query with `direct_retrieval_only: false` ⇒ topic match **does** run and KB Topics section present. |
| `test/config/keyword_schema` (if present) | Schema includes `direct_retrieval_only` in properties + required for both variants. |

Update the test provider stub [`src/testing/test_provider_factory.js`](../../src/testing/test_provider_factory.js) to emit `direct_retrieval_only` in its canned Step1 responses (e.g. `true` for the existing `direct_retrieval` gatha-6 fixture at line ~130; `false`/`null` elsewhere).

## Manual verification

With `KB_ENHANCE_ENABLED=true` (+ defaults), run a session and inspect the request context log under `logs/contexts/`:

1. **Direct-only**: `"samaysaar gatha 6 ki sanskrit teeka word by word samjhaiye"` → context log should have the `### KB Sub-workflow Results` block and the main `Source N` chunks, but **no** `### KB Topics` and **no** `### Guided Passages` sections. Confirm `kb_direct_retrieval_skip` log line emitted.
2. **Combined**: `"samaysaar gatha 6 ka saaransh batao, isme atma ki swatantrata ke vishay me kya kaha gaya hai"` → `### KB Topics` section **present**; no skip log line.

## Docs to update after implementation

- [README.md](README.md): add `direct_retrieval_only` to the Step1 schema section, add a Phase 3 note that it is skipped for direct-only queries, add the observability field, and link this spec in the Phase Spec Docs list.
- Add Implementation Notes / Diversions section at the bottom of this file.

---

## Implementation Notes (2026-06-22)

Implemented exactly as specified. Touchpoints:

- **Schema** ([`src/config/keyword_schema.js`](../../src/config/keyword_schema.js)): added `direct_retrieval_only: { type: ["boolean", "null"] }` to both `KEYWORD_EXTRACTION_SCHEMA` and `KEYWORD_EXTRACTION_SCHEMA_GUJ_SEARCH` (properties next to `kb_subworkflows`, plus both `required[]`).
- **Defaults** ([`src/orchestrator/keyword_extract.js`](../../src/orchestrator/keyword_extract.js)): `applyDirectRetrievalDefault()` coerces to a strict boolean (`=== true`); called after `applyJainPartitionDefaults`. Added `direct_retrieval_only` to the `keyword_extract_parsed` verbose log.
- **Gating** ([`src/server.js`](../../src/server.js)): `directRetrievalOnly` computed; gates both `runKbTopicMatch` (Phase 3) and `mergedTopicsForWorkflow` (Phase 4). Emits `kb_direct_retrieval_skip` log line; added `directRetrievalOnly` to `kb_topic_match_injected`.
- **Prompt** ([`prompts_sets/prompts_v2/step_1_keyword_extract_and_classification.md`](../../prompts_sets/prompts_v2/step_1_keyword_extract_and_classification.md)): added instruction item 11 + output-JSON field with examples (incl. the combined-query `false` case).
- **Test stub** ([`src/testing/test_provider_factory.js`](../../src/testing/test_provider_factory.js)): `DIRECT_RETRIEVAL_QUESTION` now emits `direct_retrieval_only: true` unless the prompt also contains `COMBINED` (→ `false`).

### Tests added (all passing)

- `test/orchestrator/keyword_extract.test.js`: pass-through when `true`; defaults to `false` when omitted/null.
- `test/config/keyword_schema.test.js`: field present + required in both schema variants.
- `test/integration/kb_enhance.integration.test.js`: scenario 13 (direct-only ⇒ `topics_match`/`topic_neighbors` not called, no `### KB Topics` / `### Guided Passages`); scenario 14 (combined ⇒ topic match runs, `### KB Topics` present).

### Notes / deviations

- No new env flag, on by default under `KB_ENHANCE_ENABLED` + `KB_ENHANCE_TOPIC_MATCH`, as decided.
- Pre-existing, unrelated test failures (model failover timing, session persistence DB, and workflow guided-filter shastra→granth mapping unit tests) were present before this change and are not affected by it; the KB unit/integration/schema suites relevant to this work pass.
