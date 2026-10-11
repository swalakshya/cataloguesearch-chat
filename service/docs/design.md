# Design (CatalogueSearch Chat)

This document proposes a non‑agentic service that calls LLM providers **directly** (OpenAI/Gemini/Anthropic/etc.) and orchestrates a **fixed retrieval + answer** workflow for CatalogueSearch. We went ahead with native provider APIs intead of frameworks Langchain etc. for scalability, customization and optimization requirements for our use case.

---

## Goals
- Use a **fixed, deterministic workflow** to answer questions.
- Call CatalogueSearch **Agent API** directly over HTTP.
- Keep the API compatible with current frontend usage when possible.
- Support multiple model providers via a simple provider interface.

## Non‑Goals
- No multi‑agent workflows.
- No OpenSearch or indexing changes.
- No embedding generation in this service.

---

## Key References
- Workflow implementation guidelines: `docs/workflow_implementation_guidelines.md`

## Search Effort (Implemented)

The chat message API accepts an optional boolean `accuracy_mode` (default `false`). The frontend reuses one compact Low/High selector inside both chat composers and the Khoj search box. Clicking it opens a popup headed Search effort, with a two-position slider. Low is the default (40 candidates); High searches 100 candidates. Settings retains Low/High radio buttons for the chat default. It saves that default under `chatAccuracyMode` in the existing account settings JSON, or in local storage for anonymous users. Changing the composer selection applies to subsequent messages without changing the saved default. New Chat restores the saved default.

When High effort is selected, the CatalogueSearch backend searches 100 candidates instead of the configured Low pool (currently 40), then reranks them before selecting the existing number of results. This is a request option; it never changes shared configuration. Khoj has the same selector, and its PDF export forwards the selected mode. High effort leaves lexical search unchanged. For RRF, the candidate count applies to each retrieval leg, as it does in Low mode.

All four retrieval workflows forward the selection to every Hindi/Gujarati search, including main/sub-queries, keyword-fix retries, and model failover. The selection comes from the user request rather than LLM extraction. Greeting, metadata, and neighbour navigation retain their existing behavior. Idempotency distinguishes a High effort request from a Low request with the same message ID.

High effort allows 60 seconds for each backend reranking operation and at least 90 seconds for its chat-service HTTP request. Low retains its existing 40-second reranking and configured transport timeout. Partial reranking preserves unscored candidates in retrieval order after scored candidates. These limits apply per retrieval operation; a multi-query chat can take longer overall. The UI describes High effort as slower, without promising a fixed response time.

Review corrections: Khoj now paginates its candidate pool even when reranking is disabled or the model is unavailable. Both frontend nginx configurations allow 120 seconds between upstream API reads so retrieval and PDF rendering have headroom beyond the 60-second reranking budget. This proxy limit applies to all `/api/` requests; it does not increase Low's model timeout.

### Verification

- Backend: from `cataloguesearch`, run `PYTHONPATH=. <python-with-project-dependencies> -m pytest tests/accuracy/test_accuracy_mode.py --confcutdir=tests/accuracy -q`.
- Frontend: from `cataloguesearch/frontend`, run `REACT_APP_EVAL_API_BASE_URL= npm test` (the empty override prevents local dev routing from changing unrelated endpoint assertions), then `npm run build`.
- Chat service: from `cataloguesearch-chat/service`, run `sh scripts/run-tests-docker.sh`.

After restarting/rebuilding the backend, chat service, and frontend:

1. In Khoj, select High and submit a semantic query. Check that `/api/search` sends `accuracy_mode: true` and the backend log reports `candidates=100`. Switch to Low and repeat; the configured pool remains 40.
2. In Default settings, set the chat search effort to High and save. Reload and open chat; High should be selected. Verify both an anonymous browser and a signed-in account.
3. Send a chat question and inspect its message request for `accuracy_mode: true`. Backend agent search logs should carry `accuracy_mode: true`; each semantic retrieval should fetch 100 candidates. Change the composer to Low and send a follow-up; that message should send `false` without ending the conversation.
4. Start New Chat. The composer should return to the saved default. Open settings, change its draft selection, and cancel; the saved default should remain unchanged.
5. With High selected in Khoj, export search results as PDF and verify `/api/export-pdf` carries the same flag. Result page/context limits remain the existing values in both modes.

## Context Reranking (Implemented, Disabled by Default)

The backend admin Search Config exposes `context_reranking` (default `false`), labeled **Rerank with surrounding context**. It applies to Khoj and chat, in both Low and High effort mode, whenever vector/RRF reranking runs. It does not force a lexical request into semantic retrieval or change the number of candidates. There is no per-user setting or model/index migration.

With the flag on, every candidate is considered for previous/next paragraph context before scoring. Candidates already in the retrieval pool supply their neighbour text directly. Remaining `(document_id, paragraph_id)` neighbours are deduplicated and fetched in one filtered OpenSearch search per retrieval. Khoj RRF first recovers original central sources in one bulk `mget`, since its fused results hold extracted snippets. Lookups omit vector embeddings, have bounded timeouts, and fall back to available text if neighbours are missing or lookup fails. Document/language filters and checks for differing known lecture/date/section metadata prevent unrelated context from being attached.

Each scoring window uses up to the final 350 characters of the previous paragraph, up to the existing first 1,000 characters of the central paragraph, and up to the first 350 characters of the next paragraph. Token counts come from the loaded tokenizer. Neighbour text is reduced first to keep the central passage's token budget intact; long central text is trimmed only when it alone exceeds the budget. The query is bounded to 128 tokens (less for a smaller configured limit). The complete query/passage pair is capped at the lower of the configured limit, tokenizer limit, and the deployed BGE-base graph's 512-token limit. Consequently, a long central paragraph can consume the whole budget and leave no neighbour text. There is no guarantee that every retrieved candidate has both neighbours available.

Returned central paragraph IDs, page references, and primary text remain intact. The API optionally includes `rerank_context.previous/next`, containing exactly the cropped neighbour excerpts used for scoring, with their own IDs and page metadata. Khoj shows these under **Surrounding context**, with links to each neighbour's PDF page. Chat expands those excerpts into independently citable LLM sources before cleaning, ID hashing, and citation construction. Overlapping direct results take priority over cropped neighbour excerpts; deduplication preserves separate Hindi/Gujarati versions. With no returned context, chat retains the original chunk inputs unchanged.

The flag is independent of the existing empty-retrieval retry and model failover: all resulting backend searches use the current admin setting. Metadata, greeting, lexical-only search, and requests without reranking retain their existing behavior. Context adds text and CPU work; the existing Low/High effort reranking deadlines still apply, so resource contention can produce partial scoring.

### Validation and rollout

- Backend: run `PYTHONPATH=. <python-with-project-dependencies> -m pytest tests/accuracy --confcutdir=tests/accuracy -q`. Tests cover flag on/off for all four vector/RRF entry points, batched lookups, token limits, long queries, language aliases, missing data, boundaries, fallback, and admin persistence/reset.
- Frontend: run `REACT_APP_EVAL_API_BASE_URL= npm test` and `npm run build`. Context display tests verify that neighbour PDF links use their own PDF page numbers.
- Chat: run `sh scripts/run-tests-docker.sh`. Tests cover neighbour source/citation identity, overlapping results, flag-off inputs, and bilingual deduplication.
- After deploying/restarting all three applications, open **Admin → Search Config**, set **Rerank with surrounding context** to `true`, and Save. For `विकल्प और विचार में क्या अन्तर है?`, inspect the results and open **Surrounding context**. Backend logs should report `Context reranking: candidates=… expanded=… neighbour_lookups=… token_limit=…`.
- In chat, verify that the answer's cited neighbour excerpts open the correct source page. Check a follow-up and Gujarati search as well. Set the admin flag to `false` or reset it to return to paragraph-only reranking without reindexing.

An isolated read-only local benchmark of the implemented vector path on that question used 100 Hindi Pravachan candidates and four ONNX threads. Retrieval plus reranking took 14.75 seconds with the flag off and 26.90 seconds with it on, excluding embedding/model startup. 92 candidates had usable context after boundary/budget checks, fetched with one neighbour search. The three reported fragments moved from ranks 7, 8, and 11 to outside the top 20. Other rankings changed substantially as well; this is a single-query diagnostic, not an overall relevance or production latency guarantee. The RRF bulk source/context lookup was also verified against five live records. Live service settings were not enabled by these tests.

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

### High‑Level Architecture (Failover Routing)
```
Frontend
  |
  | /v1/chat/sessions/{id}/messages
  v
llm_direct_service
  |  ModelRouter (priority + availability)
  |    - ModelRegistry (config)
  |    - AvailabilityTracker (sliding window)
  |
  |--> ProviderFactory -> Provider SDK (Gemini/OpenAI/...)
  |         |                     |
  |         | (keyword)           |
  |         | (workflow)          |
  |         | (answer)            |
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
- `greeting_message_v1`
- `metadata_question_v1`

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

Provider selection is done per request via model routing config.

---

## Prompts
The service uses two prompt templates:

1) **Keyword extraction prompt** (JSON output)
   - Input: user question + conversation history (all prior question/answer/chunk_ids sets)
   - Output:
    ```json
    {
      "language": "hi",
      "workflow": "basic_question_v1",
      "keywords": ["..."],
      "filters": {
        "granth": "Samaysaar"
      }
      "<other params>" : "<refer step1_keyword_extract_and_classification.md>"
    }
    ```

1b) **Keyword fix prompt (Step1b)** (JSON output)
   - Triggered only when **all retrievals return zero chunks**
   - Input: user question + Step1 JSON output
   - Output: same schema as Step1 (language, workflow, keywords, filters, etc.)

2) **Answer synthesis prompt**
   - Input: user question + retrieved chunks (in an organized format) + conversation history (all prior question/answer/chunk_ids sets)
   - Output: strict JSON `{ answer, scoring }` where `scoring` lists `{ chunk_id, score }` for chunks used in the answer.
   - Must follow **workflow‑specific answer rules**

Composition rule:
- Always include `step_2_answer_synthesis.md`
- Append the selected workflow file from `prompts_sets/<prompt_root>/workflow_answering_guidelines/`

Prompts are stored as versioned files under `service/prompts_sets/`:
```
service/prompts_sets/
  prompts_v2/
    step_1_keyword_extract_and_classification.md
    step_1b_keyword_fix.md
    step_2_answer_synthesis.md
    workflow_answering_guidelines/
      basic_question.md
      followup_question.md
      advanced_distinct_questions.md
      advanced_nested_questions.md
  prompts_v2_<modelId>/  # optional model-specific overrides
```

The keyword extraction prompt includes the **workflow catalog** so the model can select the best one at runtime.

### Model-Specific Prompt Roots
- Prompt roots are resolved per model using `prompts_v2_<modelId>` (with `.` replaced by `_`).
- If a file is missing in the model-specific folder, it falls back to the base `prompts_v2` root.
- During failover, each attempt re-runs prompts using the new model’s prompt root.

### Model-Specific Workflow Config
Workflow tuning values (page size, rerank, followup expand limits, etc.) live in `src/config/model_config.js` under `workflowDefaults`, with optional per-model `workflowOverrides`. The workflow router passes `modelId` to each workflow so the merged config applies at runtime.

## External API Usage (Direct HTTP)
Tools are **plain HTTP calls** to the External API. Names mirror the MCP tools.

| Tool Name | Endpoint | Purpose |
| --- | --- | --- |
| `external_search` | `POST /api/agent/search` | primary retrieval |
| `external_navigate` | `POST /api/agent/navigate` | surrounding context |
| `external_find_similar` | `POST /api/agent/find_similar` | related passages |
| `external_get_filter_options` | `POST /api/agent/get_filter_options` | optional filter discovery |
| `external_get_pravachan` | `POST /api/agent/get_pravachan` | full discourse |

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
  - conversation history sets: `{ id: "set_1", question, answer, chunk_ids, chunk_scores }`
- Provider session is created on `POST /v1/chat/sessions` and **reused** for all messages until idle expiry or explicit delete.
- Idle expiry closes the provider session and releases resources.

### Account conversation inactivity — implementation notes

Claimed account sessions become read-only after 48 hours without a question or
answer. Anonymous sessions keep their existing behavior. This is independent of
memory eviction: SQLite preserves old conversations and GET still returns their
messages. GET also returns `read_only` and `inactivity_remaining_ms` so clients can
check on entry, visibility changes, and at the deadline without relying on the
browser clock. Busy sessions are exempt and cannot be evicted mid-answer.

POSTing a new turn to an inactive session returns HTTP 409 with
`detail: "session_inactive"` before creating a job. Existing job recovery and
idempotent retries remain available. Clients start a new session and submit the
question there without carrying over old history. History stays ordered by
`last_activity_at DESC`; opening or renaming a conversation does not update it.
No schema or authentication changes are required.

Manual verification: log in, open a chat whose last exchange is over 48 hours old,
verify its messages remain readable in History, then send a question and verify
it appears in a new conversation. Rename the old chat and confirm its History
position does not change. Anonymous chats should retain their previous behavior.

### Conversation History Trimming (Step1)
The conversation history used for step1 follows a reset-on-non-followup rule:
- Step1 receives the current `session.conversationHistory` (may be empty).
- After step1 returns:
  - If `is_followup=true`, keep `session.conversationHistory` as-is.
  - If `is_followup=false`, trim `session.conversationHistory` to `[]` before continuing.
- Step2 receives history only when `is_followup=true`.
- After answer synthesis, append the current Q/A set into `session.conversationHistory`.

### Conversation History Summarization (Post-Response)
To prevent prompt growth in deep conversations, the service compacts history **after the response is sent**:
- When `session.conversationHistory.length` reaches **N** (default `4`), it is summarized into a single Q/A set.
- Summary is generated via a fire-and-forget LLM call (no added response latency), in Hindi.
- The summary set uses:
  - `question`: `Conversation summary`
  - `answer`: summary text (~1500–2000 tokens, soft target)
- Chunk handling:
  - From each of the N sets, keep top **C** chunks (default `1`) by score.
  - Set their scores to **100** and union them into the summary set.
  - If fewer than C chunks exist for a set, keep all.
- If the summary call fails, history remains unchanged.

Config:
- `LLM_HISTORY_SUMMARY_THRESHOLD` (default `4`)
- `LLM_HISTORY_SUMMARY_TOP_CHUNKS` (default `1`)

```
User Message N
   |
   v
Step1 Prompt (uses current session.conversationHistory)
   |
   v
Step1 Output (is_followup?)
   |\
   | \-- if false: session.conversationHistory = []
   |
   v
Workflow + Retrieval
   |
   v
Step2 Prompt (history only if is_followup=true)
   |
   v
Answer + Scoring
   |
   v
Append current Q/A set to session.conversationHistory
   |
   v
If history length reaches N: fire-and-forget summary compaction
```

---

## Data Flow (Sequence)
```
User -> Frontend -> /v1/chat/sessions (create)
                 -> /v1/chat/sessions/{id}/messages
  -> Keyword extraction + workflow selection (LLM, session‑bound)
  -> Run selected workflow (deterministic)
     -> external_search (HTTP)
     -> external_navigate / external_find_similar / external_get_pravachan (HTTP)
  -> If total chunks == 0: Step1b keyword fix (LLM) + re-run workflow retrievals once
  -> If still 0 chunks after retry: return no-context fallback (no Step2 LLM call)
  -> Answer synthesis (LLM, session‑bound) when context is available
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
LLM_API_KEY=...

EXTERNAL_API_BASE_URL=http://localhost:8000
EXTERNAL_API_TIMEOUT_SEC=60

LLM_REQUEST_TIMEOUT_SEC=120
LLM_MAX_RETRIES=2
LLM_RETRY_BACKOFF_MS=500
```

---

## Multi-Model Routing + Availability (Failover Design)
To support production reliability at scale, the service will route across multiple models by priority and use a sliding-window availability check per model. This logic is global (shared across sessions) and based on server/LLM-side failures only.

### Model Priority (Cost-Based)
Priority order (preferred → fallback):
1. `gemini-2.5-flash`
2. `gemini-3-flash-preview`
3. `gpt-4o`

### Sliding-Window Availability
- Each model keeps a time-based sliding window of recent outcomes.
- Window size: **15 minutes** (configurable).
- Failure-rate threshold: **10%** (configurable).
- Minimum samples before marking unavailable: **20** (configurable).
- Failures only include server/LLM-side errors (503, model unavailable, provider timeouts, etc.). Client-side errors are excluded.

When a model's failure rate exceeds the threshold (with minimum samples met), it is marked unavailable in memory. Availability recovers automatically as the window rolls forward.

### Routing Rules
1. Build candidate models in priority order.
2. Filter to currently available models.
3. If none available: return **503 service_unavailable** without calling any provider.
4. Try models in order until success or exhaustion:
   - On server/LLM-side failure: record failure and try next model.
   - On client-side failure: return error immediately (no failover, no failure recorded).

### Hard-Disable on 429
- If a model returns **429 Too Many Requests**, it is **immediately marked unavailable**.
- A `hardDisabledUntil` timestamp is set to `now + windowMs`.
- While hard-disabled, the model is excluded regardless of failure rate.
- Once the window elapses, normal availability checks resume.

### Concurrency Behavior (Current)
- Availability tracking is **in-memory per process** and updated as each request completes.
- Multiple concurrent requests to the same model may overlap; events are appended without locks.
- This yields **eventual consistency** for availability decisions (small timing skew is possible).

### Future Scope: Strict Concurrency Control
If stricter control is needed (e.g., to cap concurrent calls to a model or avoid herd effects), add one of:
- **Per-model in-flight limits** (semaphore/queue per model).
- **Per-model request queue** with max queue size and backpressure.
- **Shared circuit state** in Redis (cross-instance consistency).

### Config (Hard-Coded JSON for Now)
```js
const MODEL_ROUTING_CONFIG = {
  windowMs: 15 * 60 * 1000,
  failureRateThreshold: 0.10,
  minSamples: 20,
  models: [
    { id: "gemini-2.5-flash", provider: "gemini", priority: 1 },
    { id: "gemini-3-flash-preview", provider: "gemini", priority: 2 },
    { id: "gpt-4o", provider: "openai", priority: 3 },
  ],
};
```

### Provider Keys (Secret Manager)
The secret manager is shared across all models (single service account file). Each model has its own secret name; providers resolve keys by model id.

---

## Integration Tests (Docker-Only)
Integration tests run inside Docker Compose against a test-mode service instance. The service is booted only via Compose and exposes test-only endpoints when `TEST_MODE=true`.

### Test-Only Endpoints
- `POST /v1/test/reset` — resets availability tracking and provider call counters.
- `POST /v1/test/provider-behavior` — sets per-model behavior (`server_error`, `client_error`, `success`).
- `GET /v1/test/provider-stats` — returns per-model call counts.

### Scenarios Covered
1. **Failover within a request**  
   Model A returns server-side error → Model B succeeds → HTTP 200, provider set to Model B.
2. **All models unavailable**  
   All models exceed failure threshold → HTTP 503 `service_unavailable`.
3. **Client-side error does not fail over**  
   Model A returns 401 → HTTP 401, no attempt on Model B.
4. **Global availability across sessions**  
   Failures in Session 1 mark Model A unavailable → Session 2 routes directly to Model B.

### How to Run
From `service/`:
```
npm run test:integration:docker
```

This runs `service/scripts/run-integration-tests-docker.sh`, which executes:
```
docker compose -f docker-compose.yml -f docker-compose.test.yml up --build --abort-on-container-exit --exit-code-from integration-tests
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

## Basic Module Layout
```
llm_direct_service/
  src/
    server.js                # HTTP server
    config/
      model_config.js        # hard-coded model config
    utils/
      chunk.js               # merge + citation extraction
    providers/
      base.js
      openai.js
      gemini.js
      anthropic.js
      provider_factory.js    # model-based provider construction
    routing/
      model_registry.js      # model list + priority ordering
      model_availability.js  # sliding window availability tracker
      error_classifier.js    # server vs client error classifier
      model_router.js        # failover orchestration
    orchestrator/
      workflow_registry.js   # workflow catalog + selection
      workflow_router.js     # chooses workflow at runtime
      workflows/
        basic_question_v1.js
        followup_question_v1.js
        advanced_distinct_questions_v1.js
        advanced_nested_questions_v1.js
      keyword_extract.js     
      answer_synthesis.js
    agent_api/
      client.js              # HTTP calls (generated from docs/cataloguesearch/tools/external_api_openapi.yaml)
  prompts_sets/
  Dockerfile
  package.json
```

---

## Implementation Notes (First Pass)
- Started with only two providers (OpenAI and Gemini), can others via adapter/factory interface.
- Used JSON‑schema output for keyword extraction to avoid parsing errors.
- Kept the External API client minimal.
- Added a **search budget** guardrail to prevent accidental repeated searches.

---

## Gujarati Search — Multi-Language Retrieval

### What it is

An opt-in mode that fires parallel Gujarati-language searches alongside the normal Hindi searches, then synthesises a unified answer from both language corpora. The answer language stays as-per-session (Hindi or English); the LLM translates any Gujarati citation text inline.

### Activation

Two request params must both be set:

| Param | Value | Notes |
|---|---|---|
| `enable_guj_chunks` | `true` | New opt-in flag |
| `full_citations` | `false` (or absent if env default is false) | Existing param |

Internal flag throughout the codebase: **`gujChunks`** (not `multiLanguage`).

Excluded workflows regardless of params: `metadata_question_v1`, `greeting_message_v1`.

### Prompt Resolution (when `gujChunks=true`)

`prompts.js::resolvePromptRoots` prepends two extra roots before the existing ones:

1. `service/prompts_sets_guj_search/prompts_v2_<modelId>/`
2. `service/prompts_sets_guj_search/prompts_v2/`
3. `service/prompts_sets/prompts_v2_<modelId>/` ← existing
4. `service/prompts_sets/prompts_v2/` ← existing

Files absent from the guj-search tree fall through to the existing roots automatically. Only `step_1_keyword_extract_and_classification.md` and `step_2_answer_synthesis.md` are modified; all other prompt files are copied unchanged.

### Data Flow

```
POST body: { enable_guj_chunks: true, full_citations: false }
  ↓
server.js: gujChunks = !fullCitationsEnabled && enableGujChunksParam === true && !isMetadataWorkflow
  ↓
keyword_extract.js: uses KEYWORD_EXTRACTION_SCHEMA_GUJ_SEARCH
  → LLM returns keywords + keywords_guj arrays
  ↓
workflow runners: Promise.all([hindi search, gujarati search]) per query unit
  → chunks tagged _lang: "hi" / "gu"
  ↓
server.js: split by _lang → buildMultiLangContext(hindiChunks, gujaratiChunks)
  → "### Hindi Passages\n…\n\n### Gujarati Passages\n…"
  ↓
answer_synthesis.js: bilingual Jain scholar system message
  → competitive scoring across all chunks
  → LLM translates Gujarati citations to answer language inline
```

### Per-Workflow Behaviour

Each workflow fires **parallel** Hindi + Gujarati searches per logical query unit using `Promise.all`:

- **`basic_question_v1`** — 1 Hindi + 1 Gujarati search
- **`advanced_distinct_questions_v1`** — 1 Hindi + 1 Gujarati per query (queries run sequentially)
- **`advanced_nested_questions_v1`** — parallel pair for main query + each sub-query
- **`followup_question_v1`** — parallel pairs for followup keyword sets; `expand_chunk_ids` navigation calls are language-agnostic and unchanged

### Tool Budget

`WORKFLOW_TOOL_CALL_BUDGET_GUJ` env var (default: `WORKFLOW_TOOL_CALL_BUDGET * 2` = 50) is used when `gujChunks=true`.

### Config Changes

- `model_config.js` `workflowDefaults`: `gujarati_page_size: 5`
- gpt-4o `workflowOverrides`: `gujarati_page_size: 3`

### Graceful Degradation

- If `keywords_guj` is absent/empty for a query → skip Gujarati search for that query; Hindi proceeds normally.
- If Gujarati external API call fails → log warning; Hindi chunks proceed to synthesis unaffected.

### Response operation timings

Each successful chat job includes `timings: {total_ms, operations, search_work}` and saves the same object on its assistant message in the existing session JSON. No schema migration is required. The monotonic collector measures understanding, source search, and answer preparation across retries. Optional `X-Search-Timings` headers from agent search provide retrieval, surrounding-context, and reranking work; missing or malformed metadata leaves chat behavior unchanged. These nested work durations can overlap across parallel searches and must not be added to the total service execution duration. A request-local AsyncLocalStorage scope keeps concurrent chats separate. SSE stages include `started_at` for reconnecting the live elapsed timer.

Manual checks: send a question, expand the small completed timing row, reopen the session from History, and confirm the same durations. Retry/failover should accumulate repeated phases, and older messages without timing data should remain unchanged. Tests run against mocked providers and temporary SQLite databases; `node --test test/server_timings.test.js test/utils/operation_timings.test.js` checks measurement and history persistence.
