# Phase 1 (chat) — Step1 JSON Schema Extension

Step1 today returns `{ language, workflow, keywords[], filters?, … }`. We
extend it so the LLM:

1. Classifies each extracted keyword as **jain-specific** or **normal**.
2. Optionally declares one or more **kb sub-workflows** to fire in addition
   to the chosen main workflow.

No new LLM call. We only modify the Step1 prompt + JSON schema.

## Updated JSON schema (additive)

```json
{
  "language": "hi",
  "workflow": "basic_question_v1",
  "keywords": ["…", "…"],
  "jain_keywords": ["आत्मा", "द्रव्य"],
  "normal_keywords": ["definition", "meaning"],
  "filters": { "granth": "Samaysaar" },
  "kb_subworkflows": [
    {
      "name": "direct_retrieval",
      "shastra": "Samaysaar",
      "gatha_number": 6,
      "want": ["sanskrit", "bhavarth"]
    }
  ],
  "kb_entities": {
    "shastra_hints": ["Samaysaar"],
    "author_hints": []
  }
}
```

Rules:
- `jain_keywords ⊆ keywords` and `normal_keywords ⊆ keywords` — both arrays
  partition `keywords` so the orchestrator can re-derive without LLM trust.
  If the LLM omits the partition, **default to treating every keyword
  containing Devanagari as jain**.
- `kb_subworkflows[]` may be empty. Allowed names:
  `direct_retrieval`, `search_shastra_for_topics`, `search_topic_in_shastra`
  (see Phase 6).
- Each sub-workflow object has its own schema; documented in Phase 6.
- `kb_entities.shastra_hints[]` / `author_hints[]` feed Phase 5 metadata
  fuzzy match without re-extracting from `filters`.

## Prompt changes

Edit `service/prompts_sets/prompts_v2/step_1_keyword_extract_and_classification.md`:

1. Add a paragraph: *"For each extracted keyword, classify whether it is a
   Jain-tradition term (Sanskrit/Prakrit/Hindi religious vocabulary) into
   `jain_keywords[]`, otherwise into `normal_keywords[]`. The two arrays
   together must equal `keywords[]`."*
2. Add the **KB entity catalogue** (short — names and one-line purpose for
   `direct_retrieval`, `search_shastra_for_topics`, `search_topic_in_shastra`)
   with one few-shot example each.
3. Add `kb_entities` as a hint slot the LLM can populate from the question.

All other Step1 behaviour (workflow selection, filters extraction,
`is_followup`) stays as-is.

## Code changes

- `src/orchestrator/keyword_extract.js`: extend `KEYWORD_EXTRACTION_SCHEMA`
  to include `jain_keywords`, `normal_keywords`, `kb_subworkflows`,
  `kb_entities`. All optional with sensible defaults.
- `src/orchestrator/keyword_extract.js`: post-process — if partition missing,
  apply Devanagari-default split. Strip unknown sub-workflow names.

## Tests

- Unit: schema validates a sample LLM response with and without the new
  fields.
- Unit: Devanagari-default partition kicks in when LLM omits arrays.
- Snapshot: prompt file contains the new section markers.

## DoD

- [ ] Updated schema + prompt under `prompts_v2/`.
- [ ] `keyword_extract.js` handles new fields with backward compatibility.
- [ ] Existing Step1 tests still pass; new tests for partition + sub-workflow
      parsing added.
