# Phase 3b (chat) — 2-Hop Related Topic Extracts + Related Keyword Definitions in Step2

Extends [`03a_sequential_topic_anchor_expand.md`](03a_sequential_topic_anchor_expand.md).
`03a` surfaced related topics as **names only** (`related:` line — *"no extract
hydration in v1, keeps payload bounded"*). This phase hydrates them: related
topics get their **Hindi extracts + references**, related keywords get their
**Hindi definitions**, expanded to **2 content-hops**, rendered **nested under
each anchor** in Step2.

Backend dependency: [`08_content_gated_topic_neighbors.md`](../../../../dictionary-and-metadata-service/docs/design/query_engine/08_content_gated_topic_neighbors.md)
(adds `max_hops` to `topic_neighbors` and `content_only` to `topics_match`).
**This phase must not be enabled until that backend ships.**

---

## What changes

1. **`topics_match` anchors are content-only.** Pass `content_only: true` so
   anchors are never empty containers/index rows.
2. **`topic_neighbors` is hydrated + 2-hop.** Call with `max_hops: 2`,
   `include_extracts: true`, `include_references: true`. Depth is content-gated
   server-side (passing through content-less parent/label/index topics is free —
   see [`08`](../../../../dictionary-and-metadata-service/docs/design/query_engine/08_content_gated_topic_neighbors.md)).
3. **Related keywords get definitions.** Batch the merged topics' neighbor
   `related_keywords` through `keywordResolveBatch` (the Phase 7 path) and attach
   the definitions to each related keyword.
4. **Nested Step2 rendering.** Related topics render their extracts+refs and
   related keywords render their definitions, indented under the anchor.

---

## Why 2-hop here (and not graphrag)

The depth knob belongs on `topic_neighbors`, **not** a switch to `graphrag`:

- graphrag's `max_hops` controls the **keyword→topic resolve** walk (which
  anchors get discovered), **not** neighbor depth — its neighbor expansion is
  **1-hop**, the same Cypher `topic_neighbors` runs (see backend
  [`02_topic_match_api.md`](../../../../dictionary-and-metadata-service/docs/design/query_engine/02_topic_match_api.md)
  §2B). Switching to graphrag would re-introduce exactly what `03a` removed:
  re-resolving tokens through different machinery, non-comparable score scales,
  and neighbors attached only to graphrag-discovered topics.
- Our anchors are already precisely identified by the parent-aware trigram
  matcher. `topic_neighbors` expands neighbors of *exactly those*. The clean way
  to go deeper is `max_hops` on that endpoint — delivered by [`08`](../../../../dictionary-and-metadata-service/docs/design/query_engine/08_content_gated_topic_neighbors.md).

---

## Flow (per keyword set, extends [`03a`](03a_sequential_topic_anchor_expand.md))

```
1. ANCHOR  topics_match({ keywords: K, limit: KB_TOPIC_MATCH_LIMIT,
                          content_only: true,
                          include_extracts: true, include_references: true })

2. EXPAND  topic_neighbors({ topic_natural_keys: anchors.map(natural_key),
                             max_neighbors_per_topic: KB_TOPIC_NEIGHBORS_LIMIT,
                             max_hops: KB_TOPIC_NEIGHBORS_MAX_HOPS,   // = 2
                             include_extracts: true, include_references: true })

(after merge across all keyword sets)
3. DEFINE  keyword_resolve_batch({ tokens: <unique related_keywords nks across merged topics>,
                                   include_definitions: true,
                                   definitions_per_keyword: KB_DEFINITIONS_PER_KEYWORD,  // 0 = all
                                   fuzzy_top_k: 0 })
           → attach definitions onto each related keyword
```

Stages 1→2 stay sequential per set; sets stay parallel. Stage 3 is a **single
batched call after the merge** (not per anchor/keyword), keyed by
`keyword_natural_key`, deduped, capped by a new
`KB_RELATED_KEYWORD_DEFINITIONS_MAX` (default 20). Related-keyword definitions
are independent of the Phase 7 `### KB Definitions` section (which keeps using
the *used jain keywords*); to avoid duplicate fetches, dedup related-keyword nks
against the Phase 7 set is **out of scope for v1** (acceptable overlap).

## "Without getting limited from depth"

Per-related-topic extract hydration is **not** capped — `topic_neighbors`
`include_extracts` returns all displayable Hindi blocks (`cap_per_topic` not
sent). The only bound is `KB_TOPIC_NEIGHBORS_LIMIT` (count of related topics per
anchor) and `KB_TOPIC_NEIGHBORS_MAX_HOPS` (content-hop depth). Definitions per
related keyword default to all (`KB_DEFINITIONS_PER_KEYWORD=0`).

---

## Step2 context — nested rendering

`formatKbTopicsContext` (in
[`src/orchestrator/kb_topic_match.js`](../../src/orchestrator/kb_topic_match.js))
replaces the flat `related:` line with a nested block. Each related topic carries
its own extracts (each with its own `ref:`, via the existing `formatMainRef`),
and related keywords carry definitions:

```
### KB Topics (Hindi extracts, closest first)
- [KB-T-3] topic: पर्याय पर्यायी में कथंचित् भेदाभेद
  extract: <anchor extract 1>
  ref: shastra=…, गाथा=…
  related topic (hop 1): सत् व द्रव्य में कथंचित् भेदाभेद
    extract: <related topic extract>
    ref: shastra=…, …
  related topic (hop 2): <deeper related topic>
    extract: <…>
    ref: <…>
  related keyword: भेदाभेद
    definition: <hindi definition block>
```

- Order related topics by `hops ASC` (closest first), then as returned.
- A related topic with no extracts (shouldn't happen post content-gating, but be
  defensive) renders its name only.
- Reuse `formatMainRef` / `EXCLUDED_REF_FIELDS` / `stripSourcePrefix` unchanged
  for the related extracts' `ref:` lines.
- Citation tagging (`[KB-T-n]`) stays on **anchors only** in v1 (related items
  are context, not separately citable) — keep the current `citations` behavior.

---

## Config (extends [`08_config_envs_and_caps.md`](08_config_envs_and_caps.md))

| Var | Default | Description |
|---|---|---|
| `KB_TOPIC_NEIGHBORS_MAX_HOPS` | `2` | Content-hop depth passed to `topic_neighbors`. `1` = `03a` behavior. |
| `KB_TOPIC_NEIGHBORS_INCLUDE_EXTRACTS` | `true` | Hydrate related topics' extracts + references. Off → names-only (`03a`). |
| `KB_RELATED_KEYWORD_DEFINITIONS_MAX` | `20` | Cap on related keywords sent to the definitions batch. `0` disables stage 3. |

Existing `KB_TOPIC_NEIGHBORS_LIMIT`, `KB_TOPIC_MATCH_LIMIT`,
`KB_TOPIC_MERGE_LIMIT`, `KB_DEFINITIONS_PER_KEYWORD` keep their meaning. Wire the
new vars through `KB_CAPS_DEFAULTS` in
[`src/config/kb_config.js`](../../src/config/kb_config.js) for per-model override
support (orchestrators may continue reading `process.env` directly to match the
current `03a` style — see [Known Limitations #2](README.md)).

---

## Code changes

- [`src/kb_api/client.js`](../../src/kb_api/client.js)
  - `topicsMatch`: add `contentOnly = true` → body `content_only`.
  - `topicNeighbors`: add `maxHops = 1` → body `max_hops`.
- [`src/orchestrator/kb_topic_match.js`](../../src/orchestrator/kb_topic_match.js)
  - `runSingleKeywordSet`: pass `contentOnly: true` to `topicsMatch`;
    `maxHops`, `includeExtracts: true`, `includeReferences: true` to
    `topicNeighbors`.
  - After merge: new `hydrateRelatedKeywordDefinitions({ mergedTopics,
    kbApiClient, requestId })` — collect unique `neighbors.related_keywords[*]
    .keyword_natural_key` across merged topics, cap by
    `KB_RELATED_KEYWORD_DEFINITIONS_MAX`, one `keywordResolveBatch`, attach
    `definitions` back onto each related keyword by nk. Best-effort: failure logs
    a warn and leaves keywords name-only (never throws).
  - `formatKbTopicsContext`: nested rendering above.
- No change needed to `kb_definitions.js` (Phase 7 stays independent).

---

## Failure handling (extends [`03a`](03a_sequential_topic_anchor_expand.md))

- Stage 2 (`topic_neighbors`) failure → bare anchors, no related block (as 03a).
- Stage 3 (related-keyword definitions) failure → related keywords render as
  names only; never fail the request.
- Backend not yet supporting `max_hops`/`content_only` → those fields are
  additive/ignored server-side, so behavior degrades to `03a` + 1-hop. Gate
  rollout behind the backend ship regardless.

---

## Tests (`service/test/orchestrator/kb_topic_match.test.js` + integration)

- `topicsMatch` called with `content_only: true`; `topicNeighbors` called with
  `max_hops` from env + `include_extracts/references: true` (mock arg assertion).
- `hydrateRelatedKeywordDefinitions`: dedup + cap; attaches definitions by nk;
  `KB_RELATED_KEYWORD_DEFINITIONS_MAX=0` → no call; batch failure → name-only.
- `formatKbTopicsContext` snapshot: nested related-topic extracts + per-extract
  `ref:` + related-keyword definitions; `hops` ordering; empty-extracts related
  topic falls back to name-only.
- Backward-compat: `KB_TOPIC_NEIGHBORS_INCLUDE_EXTRACTS=false` reproduces the
  `03a` flat `related:` line.
- Integration: end-to-end Step2 context contains the nested block (KB mock
  extended to honor `max_hops`/`content_only` and return `hops`/hydrated
  neighbors).

Run `service/scripts/run-tests-docker.sh` (unit) + integration per AGENTS.md.

---

## Manual verification

```bash
# with KB_ENHANCE_ENABLED=true and backend 08 shipped, send a chat message whose
# topic has related topics, then inspect the synthesis context (TEST_MODE):
curl -s localhost:8012/v1/test/last-synthesis-context | jq -r . | grep -A30 "### KB Topics"
```
Expect nested `related topic (hop N):` blocks with `extract:`/`ref:` lines and
`related keyword:` blocks with `definition:` lines.

---

## DoD

- [ ] `topics_match` called with `content_only:true`; anchors never empty.
- [ ] `topic_neighbors` called with `max_hops` (env, default 2) +
      `include_extracts/references:true`.
- [ ] Related-keyword definitions fetched in one batched call after merge,
      attached by nk, capped, best-effort.
- [ ] Step2 renders related topics' extracts+refs and related keywords'
      definitions nested under each anchor, ordered by `hops`.
- [ ] New env vars wired + documented in [`08_config_envs_and_caps.md`](08_config_envs_and_caps.md).
- [ ] Tests above pass; backward-compat to `03a` via flags.
- [ ] [`03a`](03a_sequential_topic_anchor_expand.md) + [`README.md`](README.md)
      cross-link to this doc.

## Implementation Notes (2026-06-22)

- Implemented in `src/orchestrator/kb_topic_match.js` with a new
  `hydrateRelatedKeywordDefinitions()` post-merge stage. It is best-effort and
  logs `kb_related_keyword_definitions_failed` on batch failure.
- Backward compatibility is preserved in `formatKbTopicsContext()` via the
  `includeRelatedTopicExtracts` option. When
  `KB_TOPIC_NEIGHBORS_INCLUDE_EXTRACTS=false`, related topics collapse back to
  the Phase 3a flat `related:` line.
- Related-keyword hydration uses `keyword_natural_key` only. It does not dedupe
  against Phase 7 keyword-definition fetches; that remains explicitly out of
  scope for this phase.
```
