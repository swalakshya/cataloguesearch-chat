# CatalogueSearch Agent API — Enhancements (Guided Search)

Adds `guided_filters[]` to `POST /api/agent/search` so callers (chiefly
`cataloguesearch-chat` Phase 4) can ask the API to run additional
filter-scoped retrievals in parallel with the default unfiltered search and
return the results in a separate bucket.

This is a **backward-compatible additive change**. Existing callers that
omit `guided_filters` see no behavioural change.

---

## Updated request — `POST /api/agent/search`

```json
{
  "query": "द्रव्य की स्वतंत्रता",
  "language": "hi",
  "content_type": "both",
  "rerank": true,
  "page_size": 10,
  "page": 1,
  "granth": "Samaysaar",
  "guided_filters": [
    { "shastra": "samaysaar",      "gatha": 6,  "page": null, "teeka": null },
    { "shastra": "pravachansaar",  "gatha": null,"page": null, "teeka": null }
  ]
}
```

### `guided_filters[]` semantics

- Each entry is `{ shastra?, gatha?, page?, teeka? }`. Any combination of
  non-null fields applies as an AND filter for that entry's run.
- All fields optional inside an entry; entries with **all** fields null are
  ignored.
- Server runs the same `query` once **without** `guided_filters` (existing
  behaviour) and once per entry **with** that entry's filters applied.
- Each guided run uses the same `language`, `content_type`, `rerank`, and
  `page_size`. `page` is forced to 1 for guided runs.
- Server cap: at most `GUIDED_FILTERS_MAX_ENTRIES=10` entries are
  honoured; excess are ignored with a warning.

### Field-to-index mapping (suggested)

| `guided_filter` field | Maps to existing index field |
|---|---|
| `shastra` (natural_key) | `granth` (resolve natural_key → canonical name first) |
| `gatha` (integer) | `gatha_number` or equivalent in chunk metadata |
| `page` (integer) | `page_number` |
| `teeka` (natural_key) | `teeka` / contributor field if available |

Where a field doesn't have a corresponding chunk-level index, the server
SHOULD apply best-available approximation (e.g. shastra-level filter when
gatha-level isn't indexed) and surface a warning in `guided_results[].warnings`.

---

## Updated response — `POST /api/agent/search`

```json
{
  "results": [ /* existing chunks, unchanged */ ],
  "guided_results": [
    {
      "guided_filter": { "shastra": "samaysaar", "gatha": 6, "page": null, "teeka": null },
      "results": [ /* chunks under this filter */ ],
      "warnings": []
    }
  ]
}
```

- `guided_results` is OMITTED entirely when the request omits
  `guided_filters[]` or all entries are ignored. This preserves response
  shape for legacy callers.
- Chunk shape inside `guided_results[].results[]` is identical to the
  top-level `results[]` (same `text_content` + `metadata` schema).
- Reranking applies independently within each bucket.

---

## OpenAPI delta (sketch)

Add to `tools/agent_api_openapi.yaml` under `components.schemas`:

```yaml
GuidedFilter:
  type: object
  properties:
    shastra: { type: string, nullable: true }
    gatha:   { type: integer, nullable: true }
    page:    { type: integer, nullable: true }
    teeka:   { type: string, nullable: true }

GuidedResult:
  type: object
  required: [guided_filter, results]
  properties:
    guided_filter: { $ref: '#/components/schemas/GuidedFilter' }
    results:
      type: array
      items: { $ref: '#/components/schemas/Chunk' }
    warnings:
      type: array
      items: { type: string }
```

Extend `SearchRequest` with optional `guided_filters: [GuidedFilter]` and
`SearchResponse` with optional `guided_results: [GuidedResult]`.

---

## Backward compatibility

| Caller | Server | Behaviour |
|---|---|---|
| omits `guided_filters` | any | Identical to today. |
| sends `guided_filters` | old (pre-update) | Server ignores unknown field; behaves as today. |
| sends `guided_filters` | new | Returns `guided_results[]`. |
| any | new, no entries | `guided_results` omitted from response. |

---

## Implementation notes (backend agent API)

- Guided runs SHOULD execute in parallel (one extra OpenSearch query per
  entry). With `GUIDED_FILTERS_MAX_ENTRIES=10`, worst case is 11 parallel
  queries per request — confirm cluster capacity before raising the cap.
- A combined budget env (`AGENT_SEARCH_GUIDED_BUDGET_MS=20000`) caps the
  total extra latency; entries exceeding the budget are dropped with a
  warning rather than failing the request.
- Guided buckets MUST be order-preserved with the request's
  `guided_filters[]` array.

---

## Testing

- Contract test: legacy request shape → unchanged response shape.
- Contract test: request with 2 guided filters → response contains 2
  `guided_results` entries in input order.
- Contract test: entry with all-null fields → silently dropped.
- Load test: 10 guided filters under `AGENT_SEARCH_GUIDED_BUDGET_MS`.
