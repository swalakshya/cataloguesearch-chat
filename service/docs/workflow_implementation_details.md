# Workflow Implementation Details (CatalogueSearch)

This document describes how each workflow is implemented in `llm_direct_service`, including strategy and retrieval steps. It is based on the CatalogueSearch answering guidelines and extended with implementation logic to maximize accuracy using the available External API tools. No LLM calls in b/w the workflow implementation are allowed.

---

## Shared Constraints (All Workflows)

**Tooling (External API only):**
- `external_search`
- `external_navigate`
- `external_get_filter_options`

### Hard rules followed:
Prefer page 1 results for `external_search`.

**Filtering:**
- Filters are extracted in **Step 1** (keyword extraction + classification).
- If filters are present in the LLM response, resolve exact values via `external_get_filter_options` before `external_search`. If no filters in the LLM, then don't add filters and clear existing filters till now.
- Apply resolved filters to all search calls in that workflow.

**Cleaning up context**
- Cleanup all the unnecessary params from the reponses of the external API calls when passing to LLM. Only keep - file_url, chunk_id, page_number, gatha, granth, category, text_content

---

## Workflow 1: `basic_question_v1`
**Used when:** Simple definitional/comparative questions.

**Strategy:**
- Aim for a concise, high‑signal answer with minimal context expansion.

**Steps:**
1. `is_followup` must be false.
2. Use the `keywords` returned by the LLM to call `external_search` (page 1, page_size=15, rerank=true).
3. Pass all retrieved results as context to the LLM for answer synthesis step.

---

## Workflow 2: `followup_question_v1`
**Use when:** The user explicitly asks for more detail or references.

**Strategy:**
- Build a richer context window from the previous question and followup question keywords.

**Steps:**
1. `is_followup` must be true.
2. Use the `keywords` returned by the LLM to call `external_search` (page 1, page_size=15, rerank=true).
3. Use the `followup_keywords` returned by the LLM to call `external_search` (page 1, page_size=15, rerank=true).
4. Expand `expand_chunk_ids` returned by LLM using `external_navigate` (direction="both", steps=2–4) before proceeding.
5. Pass all retrieved results as context to the LLM for answer synthesis step.

---

## Workflow 3: `advanced_distinct_questions_v1`
**Use when:** User asks **multiple distinct questions** in one request.

**Strategy:**
- Decompose the question into independent queries and treat them as parallel retrieval tasks.

**Steps:**
1. Gather the `queries` array returned by the LLM.
2. For each query:
   - Call `external_search` using the `keywords` returned by the LLM (page 1, page_size=10, rerank=true).
3. Pass all retrieved results as context to the LLM for answer synthesis step.

---

## Workflow 4: `advanced_nested_questions_v1`
**Use when:** User asks **related/nested** questions.

**Strategy:**
- Use one main query plus targeted sub‑queries to capture nuance and comparisons.

**Steps:**
1. Gather `main_query` + `sub_queries` returned by the LLM.
2. Run `external_search` for the main_query `keywords` returned by the LLM (page 1, page_size=10, rerank=true).
3. For each chunk_id in the response of the above external_search response:
   - Expand with `external_navigate` (direction="both", steps=2–4)
4. For each sub_query returned by the LLM:
   - Call `external_search` using the `keywords` returned by the LLM (page 1, page_size=10, rerank=true).
5. Pass all retrieved results as context to the LLM for answer synthesis step.
