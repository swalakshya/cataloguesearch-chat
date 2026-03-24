# LLM Direct Service Design (CatalogueSearch)

This document proposes a non‑agentic **llm_direct_service** that calls LLM providers **directly** (OpenAI/Gemini/Anthropic/etc.) and orchestrates a **fixed retrieval + answer** workflow for CatalogueSearch.

---

## Goals
- Use a **fixed, deterministic workflow** to answer questions.
- Call CatalogueSearch **External API** directly over HTTP.
- Keep the API compatible with current frontend usage when possible.
- Support multiple model providers via a simple provider interface.

## Non‑Goals
- No multi‑agent workflows.
- No OpenSearch or indexing changes.
- No embedding generation in this service.

---

## Key References
- External API implementation: `backend/api/external_api.py`
- External API contract: `backend/api/external_api_README.md`
- Tool schema for external API: `tools/external_api_openapi.yaml` / `tools/external_api_openapi.json`
- Tool usage guidance: `tools/cataloguesearch_tools.md`
- Workflow implementation guidelines: `docs/workflow_implementation_guidelines.md`

---

## High‑Level Architecture
```
Frontend (feature flag)
   |
   |
   | /v1/chat/sessions
   v
llm_direct_service --> LLM Calls (Through SDK) --> Generate Answer
   |
   | HTTP (External API)
   v
cataloguesearch-api (FastAPI)
   |
   v
OpenSearch
```

---

## Deterministic Workflow (Abstracted + Extensible)
The service runs a **deterministic pipeline** for each user question, but the workflow is **abstracted behind a strategy interface** so we can add other answer generation methods later. Workflow selection is **decided at runtime** by the LLM during the initial keyword extraction call.

```
interface AnswerWorkflow {
  name(): string
  run(input: WorkflowInput): Promise<WorkflowOutput>
}
```

```
type WorkflowInput = {
  question: string
  language: string
  extracted?: {
    workflowName: string
  }
}
```

```
type WorkflowOutput = {
  answer: string
  citations: { granth?: string, category?: string, page_number?: number, file_url: string }[]
  references: string[]
  warnings?: string[]
}
```

Default workflows (initial implementation):
- `basic_question_v1`
- `followup_question_v1`
- `advanced_distinct_questions_v1`
- `advanced_nested_questions_v1`

---

## Provider Abstraction
A minimal provider interface keeps the service model‑agnostic.

```
interface LLMProvider {
  name(): string
  completeText(request: LLMRequest): LLMResponse
  completeJson(request: LLMJsonRequest): LLMJsonResponse
}
```

**Planned providers** (examples):
- OpenAI: `gpt-4o`, `gpt-4.1` (official SDK)
- Gemini: `gemini-2.5-flash` / `gemini-2.5-pro` (official SDK)
- Anthropic: `claude-3.7` (official SDK)

Provider selection is done per request or via `LLM_PROVIDER` + model config.

---

## Prompts
The service uses two prompt templates:

1) **Keyword extraction prompt** (JSON output)
   - Input: user question
   - Output:
    ```json
    {
      "language": "hi",
      "workflow": "basic_question_v1",
      "keywords": ["..."],
      "filters": {
        "granth": "Samaysaar"
      }
      "<other params>" : "<refer step1_keyword_extract_and_classification>"
    }
    ```

2) **Answer synthesis prompt**
   - Input: user question + retrieved chunks (in an organized format)
   - Must follow:
     - `mcp/backend/guidelines/cataloguesearch_answering_guidelines.md`
     - `tools/cataloguesearch_tools.md` (format and citation rules)
   - Must follow **workflow‑specific answer rules** (defined below).

Composition rule:
- Always include `step_2_answer_synthesis.md`
- Append the selected workflow file from `prompts/workflows/`

Prompts are stored as versioned files under:
```
llm_direct_service/prompts/
  step_1_keyword_extract_and_classification.md
  workflow_catalog.md
  step_2_answer_synthesis.md
  workflows/
    basic_question.md
    followup_question.md
    advanced_distinct_questions.md
    advanced_nested_questions.md
```

The keyword extraction prompt includes the **workflow catalog** so the model can select the best one at runtime.

### Workflow‑Specific Answer Rules
The answer synthesis prompt must enforce the rules for the **selected workflow**:

#### Workflow: `basic_question_v1`
Use for simple definitional/comparative questions (e.g., “Jeev kise kehte hain?”).

Answer must include:
- Simple definition
- 2–3 line explanation
- One scripture reference

Structure:
1. Definition
2. Short explanation
3. Reference

Total length: 3–5 lines maximum.

#### Workflow: `followup_question_v1`
Use when the user requests more detail (e.g., “Aur batao”, “Detail me”, “Granth reference”, “More explanation”).

Answer must include:
- Deeper explanation
- Concept breakdown
- Multiple scripture references

Structure:
1. Explanation
2. Bullet points
3. Multiple references

#### Workflow: `advanced_distinct_questions_v1`
Use when the user asks **multiple distinct questions** in one request.

Retrieval guidance (distinct questions):
1. Decompose the user question into multiple queries.
2. For each query, call `external_search` first (use 2–5 key terms; add synonyms only when essential).
3. After initial context, expand each query using one of:
   - `external_navigate` (preferred), or
   - `external_get_pravachan` (rare; only when a Pravachan number is known).
4. If more context is still needed, run one additional `external_search` for important key terms found in the retrieved context.

Answer must include:
- Separate sections per question
- 2–4 references overall (at least one per question)
- Short summary at the end

#### Workflow: `advanced_nested_questions_v1`
Use when the user asks **related/nested questions** (philosophical/comparative).

Retrieval guidance (related/nested questions):
1. Create one main query plus 1–3 sub-queries as needed.
2. For the main query, call `external_search` first (use 2–5 key terms; add synonyms only when essential).
3. After initial context, expand sub-questions using one of:
   - `external_navigate` (preferred), or
   - `external_get_pravachan` (rare; only when a Pravachan number is known).
4. If more context is still needed, run one additional `external_search` for a sub-question, building it from:
   - the sub-question, and
   - key terms found in the retrieved context.
5. Repeat step 3 for the new context if needed.

Answer may include:
- Concept explanation
- Examples
- 3–4 references
- Short summary

#### “Ask More” Suggestions
After answers add:
“You may also ask:”
- Jeev ke prakar
- Ajiv kya hai
- Karma kya hai

#### Handling Unknown Questions
If the bot is unsure:
Response format:
"Not able to answer the question either due to insufficient references found or multiple interpretations. Try again with expanding the filter range if possible OR
To avoid incorrect guidance, we recommend consulting a knowledgeable Acharya or scholar."

---

## External API Usage (Direct HTTP)
Tools are **plain HTTP calls** to the External API. Names mirror the MCP tools.

| Tool Name | Endpoint | Purpose |
| --- | --- | --- |
| `external_search` | `POST /api/external/search` | primary retrieval |
| `external_navigate` | `POST /api/external/navigate` | surrounding context |
| `external_find_similar` | `POST /api/external/find_similar` | related passages |
| `external_get_filter_options` | `POST /api/external/get_filter_options` | optional filter discovery |
| `external_get_pravachan` | `POST /api/external/get_pravachan` | full discourse |

Authoritative schemas live in:
- `tools/external_api_openapi.yaml`
- `tools/external_api_openapi.json`

---

## API Surface (Service)
Session‑only (drop‑in for existing FE). Same as `llm_service_node`:
- `POST /v1/chat/sessions`
- `POST /v1/chat/sessions/{id}/messages`
- `GET /v1/chat/sessions/{id}`
- `DELETE /v1/chat/sessions/{id}`

**Behavior note:** each session keeps a **provider session open** for the LLM (where supported) and each message uses the deterministic workflow selected at runtime.

## Session Management
- A session holds:
  - provider account/model selection
  - provider SDK session id (or equivalent handle)
  - message history (for auditing and optional context)
- Provider session is created on `POST /v1/chat/sessions` and **reused** for all messages until idle expiry or explicit delete.
- Idle expiry closes the provider session and releases resources.

---

## Data Flow (Sequence)
```
User -> Frontend -> /v1/chat/sessions (create)
                 -> /v1/chat/sessions/{id}/messages
  -> Keyword extraction + workflow selection (LLM, session‑bound)
  -> Run selected workflow (deterministic)
     -> external_search (HTTP)
     -> external_navigate / external_find_similar / external_get_pravachan (HTTP)
     -> Answer synthesis (LLM, session‑bound)
<- Response (answer + citations + references)
```

---

## Response Formatting Rules
- Always include inline citations and a final **References** section.
- Citation fields are derived from chunk metadata:
  - `granth` or `category`
  - `page_number`
  - `file_url`
- **Never** expose `chunk_id` in responses.

---

## Configuration
Example environment variables:
```
LLM_SERVICE_PORT=8012
LLM_PROVIDER=openai
LLM_MODEL=gpt-4o
LLM_API_KEY=...

EXTERNAL_API_BASE_URL=http://localhost:8000
EXTERNAL_API_TIMEOUT_SEC=60

LLM_REQUEST_TIMEOUT_SEC=120
LLM_MAX_RETRIES=2
LLM_RETRY_BACKOFF_MS=500
```

---

## Error Handling
- External API failure: return `502` with `tool_backend_error`.
- Provider failure / timeout: return `503` with `provider_unavailable`.
- Partial context: return `warnings` and a conservative answer.

---

## Logging
Structured logs include:
- `request_id`
- `provider`, `model`
- `tool_trace_id`
- `latency_ms`
- `tool_calls_count`
- `external_api_latency_ms`

Do not log API keys or raw credentials.

---

## Suggested Module Layout
```
llm_direct_service/
  src/
    server.ts                # HTTP server
    providers/
      base.ts
      openai.ts
      gemini.ts
      anthropic.ts
    orchestrator/
      workflow_registry.ts   # workflow catalog + selection
      workflow_router.ts     # chooses workflow at runtime
      workflows/
        basic_question_v1.ts
        followup_question_v1.ts
        advanced_distinct_questions_v1.ts
        advanced_nested_questions_v1.ts
      keyword_extract.ts     # includes workflow catalog in prompt
      answer_synthesis.ts
      chunk_utils.ts         # merge + citation extraction
    external_api/
      client.ts              # HTTP calls
      schemas/               # generated from tools/external_api_openapi.yaml
    prompts/
      keyword_extract.md
      answer_synthesis.md
  Dockerfile
  package.json
```

---

## Why This Solves the Current Issue
- Removes MCP + agent loop from the critical path.
- Uses **direct provider SDKs** with explicit concurrency/rate‑limit handling.
- Keeps the workflow deterministic and debuggable, aligned with CatalogueSearch guidelines.

---

## Implementation Notes (First Pass)
- Start with a single provider (OpenAI or Gemini) and add others via adapter interface.
- Use JSON‑schema output for keyword extraction to avoid parsing errors.
- Keep the External API client minimal and generated from `tools/external_api_openapi.yaml`.
- Add a **search budget** guardrail to prevent accidental repeated searches.
