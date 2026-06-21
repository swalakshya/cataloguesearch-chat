# Phase 3a (chat) — Sequential Topic Anchor → Expand

**Supersedes the parallel design in
[`03_topic_match_and_extracts.md`](03_topic_match_and_extracts.md).** That phase
fired `topics_match` and `graphrag` in parallel and merged by `topic_natural_key`.
This phase replaces that with a two-stage pipeline that actually serves the goal
"a topic **and its related topics**".

## Why the parallel design was wrong for this goal

- `topics_match` is the precise **topic identifier** (trigram over the topic's
  hierarchical name path — see kb
  [`02_topic_match_api.md`](../../../../dictionary-and-metadata-service/docs/design/query_engine/02_topic_match_api.md) §2A).
- `graphrag` seeds on **keyword nodes**, not topics, and its `neighbors` are the
  related topics of *graphrag's own* keyword-traversed topics — not of the topic
  `topics_match` matched.
- In the old merge, `neighbors` were attached **only** to graphrag hits. So any
  topic found only by `topics_match` (exactly the parent-path case trigram is
  meant to win) came back with **zero related topics** — defeating the goal.
- The two also re-resolved the same tokens through different machinery and were
  sorted on non-comparable score scales.

## New flow

For each keyword set `K` (same per-workflow extraction as
[`03_topic_match_and_extracts.md`](03_topic_match_and_extracts.md) "When to run"):

```
1. ANCHOR  topics_match({ keywords: K, limit: KB_TOPIC_MATCH_LIMIT,
                          include_extracts: true, include_references: true })
              → anchors[] (the identified topics, with extracts/refs)

2. EXPAND  topic_neighbors({ topic_natural_keys: anchors.map(natural_key),
                             max_neighbors_per_topic: KB_TOPIC_NEIGHBORS_LIMIT,
                             include_extracts: false, include_references: false })
              → neighbors_by_anchor[]   (related topics per anchor)
```

`topic_neighbors` is the new kb endpoint specified in
[`07_topic_neighbors_api.md`](../../../../dictionary-and-metadata-service/docs/design/query_engine/07_topic_neighbors_api.md).

The two stages are **sequential** (expand depends on anchor output), but all
keyword sets still run **in parallel** with each other, and within a set the
single `topic_neighbors` call covers all anchors at once. So per keyword set this
is exactly 2 sequential kb calls (was 2 parallel).

### graphrag is removed from this path

Per the chosen design, the parallel `graphrag` union is dropped. `graphrag` and
its chat client method may remain for other callers but are **not** used in
topic-match anymore.

## Assembling the result

```
for each anchor a in anchors:
  a.neighbors = neighbors_by_anchor[a.natural_key] || { related_topics, related_keywords, mentioned_in_gathas }
sort anchors by score DESC          # topics_match score (single, comparable scale)
take top KB_TOPIC_MERGE_LIMIT
```

- Anchors keep their `extracts_hi` / `references` from stage 1 (Hindi only).
- `related_topics` from stage 2 are attached under each anchor's `neighbors`
  and surfaced in Step2 context as a short "related" line (no extract hydration
  in v1 — keeps payload bounded).
- Output shape stays compatible with downstream consumers:
  - **Phase 4** guided filters still read `anchor.references[]`.
  - **Phase 7** still reads `matched_seed_keywords` / keyword refs.

## Failure handling

- Stage 1 fails → log warning, return `[]` for that set (no anchors, nothing to
  expand). Never fail the user request.
- Stage 1 succeeds, stage 2 fails → log warning, return anchors **without**
  neighbors (degrade to plain topic match). Related topics are best-effort.
- All sets empty → pipeline proceeds with vector RAG only (unchanged).

## Step2 context injection

Same `### KB Topics` section as
[`03_topic_match_and_extracts.md`](03_topic_match_and_extracts.md), with one
added optional line per topic:

```
### KB Topics (Hindi extracts, closest first)
- topic: <display_text_hi>
  extract: <text_hi of extract 1>
  ref: shastra=<sn>[, teeka=<tn>], <field>=<val>, …
  extract: <text_hi of extract 2>
  ref: shastra=<sn>, …
  related: <display_text_hi of related_topics, comma-joined, capped>
- …
```

> **Updated 2026-06-21** — the topic context now renders **all** extracts (not
> just the first) and pairs **each** extract with its own `ref:` line, derived
> from the extract's `main_reference` (see backend
> [`05_definitions_and_extracts_hydration.md`](../../../../dictionary-and-metadata-service/docs/design/query_engine/05_definitions_and_extracts_hydration.md)).
> See the Implementation Notes below for the exact rules.

## Config (Phase 8 additions)

```
KB_TOPIC_MATCH_LIMIT=5          # anchors per keyword set (existing)
KB_TOPIC_NEIGHBORS_LIMIT=10     # max related topics per anchor (new)
KB_TOPIC_MERGE_LIMIT=5          # final cap across anchors (existing)
# KB_GRAPHRAG_LIMIT — now unused by this path; leave for any other graphrag caller
```

## Code changes

- `src/kb_api/client.js`: add `topicNeighbors({ topicNaturalKeys,
  maxNeighborsPerTopic, includeExtracts, includeReferences }, requestId)`
  returning `parsed.neighbors_by_anchor || []`. Match the existing
  `topicsMatch` / `graphrag` method style.
- `src/orchestrator/kb_topic_match.js`:
  - `runSingleKeywordSet` → make sequential: `topicsMatch` then, if anchors,
    `topicNeighbors`. Drop the `graphrag` call.
  - Replace `mergeTopicResults(topicsMatch, graphrag)` with
    `attachNeighbors(anchors, neighborsByAnchor)` — a pure function keyed by
    `topic_natural_key`; keep the score-sort + `KB_TOPIC_MERGE_LIMIT` slice.
  - `extractKeywordSets` is unchanged.
- `formatKbTopicsContext`: add the `related:` line when `topic.neighbors
  .related_topics` is non-empty.

## Tests

- `attachNeighbors` unit: anchor with neighbors, anchor without (stage-2 miss),
  unknown-anchor row ignored, cap applied.
- Per-workflow: assert 1 `topicsMatch` + 1 `topicNeighbors` call per keyword set
  (mock call-count); assert **no** `graphrag` call.
- Sequential ordering: `topicNeighbors` receives exactly the anchors'
  `topic_natural_key`s.
- Failure modes: stage-1 reject → `[]`; stage-2 reject → anchors without
  neighbors; both-sets-empty → synthesis still runs.
- `formatKbTopicsContext` snapshot incl. the `related:` line.

## DoD

- [ ] Anchor (`topics_match`) → expand (`topic_neighbors`) runs sequentially per
      keyword set; sets still parallel to each other.
- [ ] Every anchor (incl. trigram-only) gets its related topics, not just
      graphrag-derived ones.
- [ ] `graphrag` no longer called in the topic-match path.
- [ ] Failures degrade gracefully (stage-2 failure → bare anchors).
- [ ] Caps configurable: `KB_TOPIC_MATCH_LIMIT`, `KB_TOPIC_NEIGHBORS_LIMIT`,
      `KB_TOPIC_MERGE_LIMIT`.
- [ ] Step2 `related:` line rendered; Phase 4 / Phase 7 consumers unaffected.

## Implementation Notes (2026-06-21) — all extracts + per-extract `ref:`

The earlier `formatKbTopicsContext` showed only `extracts_hi[0]` and a single
topic-level `refs:` line built from the flattened (cross-extract) `references`
list. That dropped later extracts and merged refs from different extracts under
one heading. Fixed in `src/orchestrator/kb_topic_match.js`:

- **Path removed** — the topic line is now `- [id] topic: <display_text_hi>`
  (no `(path: …)`).
- **All extracts rendered** — iterate `topic.extracts_hi`, emitting an
  `extract:` line per block.
- **Per-extract main ref** — each extract's `main_reference` (added by the
  backend hydrator; the modal's first non-inline resolved ref) is rendered as a
  single `ref:` line. The topic-level `refs:` line is gone.
- **`formatMainRef(mainReference)`** builds `shastra=<name>[, teeka=<name>]`
  then appends every `resolved_fields` entry **except** the publication
  locators `पुस्तक` / `पृष्ठ` / `पंक्ति` (`EXCLUDED_REF_FIELDS`). Field names
  carrying a shastra/teeka prefix are stripped via `stripSourcePrefix`
  (e.g. `धवलासूत्र` → `सूत्र`, `श्लोकवार्तिकवार्तिक` → `वार्तिक`). Returns null
  when nothing remains, so an extract with no `main_reference` emits no `ref:`.
- `source_url` citation tagging (`[KB-T-n]`) and the `related:` line are
  unchanged.
