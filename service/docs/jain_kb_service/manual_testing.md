# Jain KB Service — Manual Testing Guide

This document provides step-by-step curl commands to manually verify the KB enhancement pipeline when `KB_ENHANCE_ENABLED=true`.

## Prerequisites

1. Start the kb-service at the expected URL (or point `KB_SERVICE_BASE_URL` to a running instance).
2. Start the chat service with `KB_ENHANCE_ENABLED=true`:

```bash
# From repo root
KB_ENHANCE_ENABLED=true \
KB_SERVICE_BASE_URL=http://localhost:8004 \
docker compose up --build
```

Or with individual phase flags for staged rollout:

```bash
KB_ENHANCE_ENABLED=true \
KB_ENHANCE_KEYWORD_RESOLVE=true \
KB_ENHANCE_TOPIC_MATCH=true \
KB_ENHANCE_DEFINITIONS=true \
KB_SERVICE_BASE_URL=http://localhost:8004 \
docker compose up --build
```

---

## Create a session

```bash
SESSION=$(curl -s -X POST http://localhost:8012/v1/chat/sessions \
  -H 'Content-Type: application/json' \
  -d '{}' | jq -r .session_id)

echo "Session: $SESSION"
```

---

## Test 1: Basic Jain question (verifies KB resolve + topic-match + definitions)

```bash
curl -s -X POST "http://localhost:8012/v1/chat/sessions/$SESSION/messages" \
  -H 'Content-Type: application/json' \
  -d '{"role":"user","content":"आत्मा क्या है?","response_format":"structured"}' \
  | jq '{answer_len: (.answer|length), follow_up_questions, references: (.references|length)}'
```

**Expected in service logs:**
- `kb_keyword_check_split` — shows matched/missed jain_keywords
- `kb_topic_match_start` — shows `keywordSetCount: 1`
- `kb_topic_match_complete` — shows `merged > 0`
- `kb_definitions_start` — shows `keywords: N`
- `kb_topic_match_injected` — shows `injected: true, kbCallCount > 0`

---

## Test 2: Sub-workflow — direct_retrieval (specific gatha)

```bash
SESSION2=$(curl -s -X POST http://localhost:8012/v1/chat/sessions \
  -H 'Content-Type: application/json' \
  -d '{}' | jq -r .session_id)

curl -s -X POST "http://localhost:8012/v1/chat/sessions/$SESSION2/messages" \
  -H 'Content-Type: application/json' \
  -d '{"role":"user","content":"Samaysaar ki 6vi gatha batao","response_format":"structured"}' \
  | jq '.answer | .[0:500]'
```

**Expected in service logs:**
- `kb_subworkflows_start` — shows `names: ["direct_retrieval"]`
- `kb_subworkflow_direct_retrieval_complete` — shows projected fields
- `kb_topic_match_injected` — shows `kbSubworkflowsCount: 1`

---

## Test 3: Sub-workflow — search_topic_in_shastra

```bash
SESSION3=$(curl -s -X POST http://localhost:8012/v1/chat/sessions \
  -H 'Content-Type: application/json' \
  -d '{}' | jq -r .session_id)

curl -s -X POST "http://localhost:8012/v1/chat/sessions/$SESSION3/messages" \
  -H 'Content-Type: application/json' \
  -d '{"role":"user","content":"Samaysaar ki gatha 49 mein kaunse topics hain?","response_format":"structured"}' \
  | jq '.answer | .[0:500]'
```

**Expected in service logs:**
- `kb_subworkflows_start` — shows `names: ["search_topic_in_shastra"]`
- `kb_subworkflow_topics_in_shastra_complete` — shows `topicsCount > 0`

---

## Test 4: Sub-workflow — search_shastra_for_topics

```bash
SESSION4=$(curl -s -X POST http://localhost:8012/v1/chat/sessions \
  -H 'Content-Type: application/json' \
  -d '{}' | jq -r .session_id)

curl -s -X POST "http://localhost:8012/v1/chat/sessions/$SESSION4/messages" \
  -H 'Content-Type: application/json' \
  -d '{"role":"user","content":"द्रव्य के बारे में किन किन शास्त्रों में लिखा है?","response_format":"structured"}' \
  | jq '.answer | .[0:500]'
```

**Expected in service logs:**
- `kb_subworkflows_start` — shows `names: ["search_shastra_for_topics"]`
- `kb_subworkflow_shastras_for_topic_complete` — shows `shastraCount > 0`

---

## Test 5: Jain keyword with a typo (verifies fuzzy suggestions → Step1b)

```bash
SESSION5=$(curl -s -X POST http://localhost:8012/v1/chat/sessions \
  -H 'Content-Type: application/json' \
  -d '{}' | jq -r .session_id)

curl -s -X POST "http://localhost:8012/v1/chat/sessions/$SESSION5/messages" \
  -H 'Content-Type: application/json' \
  -d '{"role":"user","content":"aatmaa kya hai?","response_format":"structured"}' \
  | jq '.answer | .[0:500]'
```

**Expected in service logs (when KB has suggestions for the typo):**
- `kb_keyword_check_split` — shows `missed: 1`
- `kb_keyword_check_step1b_trigger` — Step1b firing with suggestions
- `keyword_fix_prompt_tokens_estimate` — higher token count than baseline (suggestions added)

---

## Test 6: Verify KB disabled (master flag off)

```bash
# Start without KB
docker compose up --build  # (no KB_ENHANCE_ENABLED set, defaults to false)

SESSION6=$(curl -s -X POST http://localhost:8012/v1/chat/sessions \
  -H 'Content-Type: application/json' \
  -d '{}' | jq -r .session_id)

curl -s -X POST "http://localhost:8012/v1/chat/sessions/$SESSION6/messages" \
  -H 'Content-Type: application/json' \
  -d '{"role":"user","content":"आत्मा क्या है?","response_format":"structured"}' \
  | jq '.answer | .[0:200]'
```

**Expected in service logs:**
- `service_start` shows `kbEnhanceEnabled: false`
- No `kb_api_request` or `kb_topic_match_start` log lines
- `kb_topic_match_injected` shows `topicsCount: 0, injected: false, kbCallCount: 0`

---

## Observability: Per-request KB stats

Check `kb_topic_match_injected` log entries for these fields:

| Field | Meaning |
|---|---|
| `kbCallCount` | Total HTTP calls to KB service in this request |
| `kbCallTotalMs` | Sum of latency across all KB HTTP calls |
| `kbCallErrorCount` | Number of KB HTTP calls that returned an error |
| `topicsCount` | KB topics merged and available for context |
| `injected` | Whether `### KB Topics` section was added to LLM context |
| `kbSubworkflowsCount` | Number of sub-workflow results injected |
| `kbDefinitionsSectionPresent` | Whether definitions section was injected |
| `kbMetadataSectionPresent` | Whether metadata section was injected |

---

## Context ordering verification (LOG_LEVEL=verbose)

With verbose logging, inspect the Step2 prompt. Sections should appear in this order:

1. `### KB Metadata Matches` (Phase 5, if any)
2. `### KB Definitions (Hindi)` (Phase 7, if any)
3. `### KB Topics (Hindi extracts, closest first)` (Phase 3, if any)
4. `### KB Sub-workflow Results` (Phase 6, if any)
5. `### Vector Passages (default)` / chunk context (existing)
6. `### Guided Passages (kb-suggested filters)` (Phase 4, if any)
