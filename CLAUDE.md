# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Implementation Guidelines
- After analysis of every task, ask all the clarifying questions (if any) to the user in one go itself.

### Coding Conventions
- **Pattern**: Functional components with named exports.
- **Safety**: Do not modify database schemas or auth flows without an explicit approvals (if not asked by user in the start).
- **Verification**: Every change must include a successful test run before completion (docker testing).

## Project Overview

A two-part AI chat system for CatalogueSearch (a Jain scripture search engine):
- **`service/`** — Node.js middleware managing multi-turn chat sessions with LLM-powered RAG retrieval from CatalogueSearch external API.
- **`mcp/`** — Python MCP server exposing CatalogueSearch as tools for Claude Desktop/Cline

Both components call a CatalogueSearch backend API (`EXTERNAL_API_BASE_URL`) and support multiple LLM providers (Gemini, OpenAI).

## Commands

Docker based runs are preferred for building and testing. From the repo root:

```bash
docker compose up --build                         
# Start service on port 8012
cd service && sh scripts/run-tests-docker.sh      
# Run unit tests in Docker
cd service && sh scripts/run-integration-tests-docker.sh                  
# Run integration tests via docker-compose
```

## Architecture

### Request Flow

1. **Create Session** — `POST /v1/chat/sessions` → session stored in `SessionRegistry`, returns `session_id`
2. **Send Message** — `POST /v1/chat/sessions/{id}/messages`
3. **Step 1 — Keyword Extraction** (`orchestrator/keyword_extract.js`) — LLM call extracts keywords, workflow type, filters, language
4. **Step 1b — Keyword Fix** — if extraction returns zero chunks, retry with corrected keywords
5. **Workflow Execution** (`orchestrator/workflow_router.js`) — routes to one of five workflows:
   - `basic_question_v1` — single search
   - `followup_question_v1` — multi-search with navigation expansion
   - `advanced_distinct_questions_v1` — parallel queries for multiple questions
   - `advanced_nested_questions_v1` — main + sub-queries for nested topics
   - `metadata_question_v1` — metadata-only answers
6. **Step 2 — Answer Synthesis** (`orchestrator/answer_synthesis.js`) — LLM call generates answer with citations
7. **Response** — `{ answer, follow_up_questions, references, citations, provider, tool_trace_id }`

### Model Routing & Failover

`src/routing/` contains the full failover logic:
- `ModelRouter` iterates models by priority (defined in `src/config/model_config.js`)
- `ModelAvailabilityTracker` uses a sliding window (default 15 min) to track failure rates
- Hard disable on 429 (rate limit); soft disable on 503 if failure rate > 10% with ≥ 20 samples
- Automatic fallback to next available model

### Configuration Hierarchy

For prompts, the system resolves model-specific → v2 fallback → v1 fallback:
1. `prompts_sets/prompts_v2_[MODEL_ID]/` (model-specific overrides)
2. `prompts_sets/prompts_v2/` (default v2)
3. `prompts_sets/prompts/` (legacy v1)

When `gujChunks=true` (Gujarati search mode), two extra roots are **prepended** before the above:
1. `prompts_sets_guj_search/prompts_v2_[MODEL_ID]/`
2. `prompts_sets_guj_search/prompts_v2/`

For workflow parameters, `src/config/model_config.js` defines `MODEL_ROUTING_CONFIG` with per-model `workflowOverrides` merged over `workflowDefaults` from `src/config/workflow_config.js`.


### Gujarati Search Mode (`gujChunks`)

Activated when a message request includes `enable_guj_chunks: true` AND `full_citations: false`. Internal flag: `gujChunks`.

- Each workflow fires **parallel** Hindi + Gujarati searches per query unit; chunks are tagged `_lang: "hi"/"gu"` internally.
- `buildMultiLangContext(hindiChunks, gujaratiChunks)` in `utils/chunk.js` produces a two-section context string for the LLM.
- Answer synthesis uses a bilingual Jain scholar system message; LLM translates Gujarati citation text to the answer language inline.
- `_lang` is stripped before chunks reach the client.
- Excluded workflows: `metadata_question_v1`, `greeting_message_v1`.
- Full design: `service/docs/design.md` → "Gujarati Search" section.

### Chunk Processing Pipeline

Retrieved chunks are: cleaned (`utils/chunk.js`) → ID-hashed for clients (`utils/chunk_hash.js`) → scored by relevance (`utils/scoring.js`) → built into LLM context → citations parsed from LLM answer (`utils/answer.js`).

### Session Management

Sessions are stored in-memory with idle eviction. Each session tracks conversation history, the assigned provider/model, language, and timestamps. Token limit enforcement rejects requests when history exceeds the configured threshold.

## Testing

Tests use Node.js built-in `node:test` runner (no Jest/Mocha). Test files are `*.test.js` in `service/test/`, organized by module:
- Unit tests: `test/orchestrator/`, `test/routing/`, `test/config/`, `test/utils/`, etc.
- Integration tests: `test/integration/` (model failover, history summarization, chat flow)
- Test utilities/mocks: `test/test_support/`

