# CatalogueSearch “Tools Package” (Non‑MCP LLMs)

This folder (`tools/`) is a **drop-in specification + prompt pack** for using the **CatalogueSearch agent API** from LLMs/agent frameworks that **do not natively speak MCP**.

---

## What CatalogueSearch is (context)

CatalogueSearch is an OpenSearch-backed hybrid retrieval system for multilingual (Hindi/Gujarati) corpora of Jain texts (PDFs). It indexes two primary categories:

- **Granth (Mool Agam)**: original Jain scriptures written by saints/scholars.
- **Pravachan**: discourses by Gurudev Shri Kanji Swami (Kahan Guru).

The agent API exposes:
- hybrid search (keyword + vector), optional reranking,
- metadata filters (granth, anuyog, contributor, pravachan year ranges),
- navigation across sequential paragraphs within the same document,
- “find similar” across the whole corpus,
- full text retrieval for a numbered Pravachan.

---

## Files in `tools/`

- `tools/cataloguesearch.md` (this file): how to build/use the tools and the agent policy.
- `tools/agent_api_openapi.json` / `tools/agent_api_openapi.yaml`: authoritative request/response schemas for HTTP tools.

If you are implementing tool wrappers, prefer generating client code from the OpenAPI spec and mapping each operationId to your agent framework’s tool/function mechanism.

---

## 1) Tool Surface (HTTP endpoints)

These tools correspond 1:1 with the MCP tools and with the backend agent API endpoints.

Base URL examples:
- Local: `http://localhost:8000`
- Production: `https://<your-domain>`

All endpoints are `POST`:

1. `POST /api/agent/search`
2. `POST /api/agent/navigate`
3. `POST /api/agent/find_similar`
4. `POST /api/agent/get_filter_options`
5. `POST /api/agent/get_metadata_options`
6. `POST /api/agent/get_pravachan`

Authoritative schema:
- `tools/agent_api_openapi.yaml` or `tools/agent_api_openapi.json`

### Mapping (recommended tool names)

When defining tools/functions in your agent framework, use these stable names:

- `agent_search` → `POST /api/agent/search`
- `agent_navigate` → `POST /api/agent/navigate`
- `agent_find_similar` → `POST /api/agent/find_similar`
- `agent_get_filter_options` → `POST /api/agent/get_filter_options`
- `agent_get_metadata_options` → `POST /api/agent/get_metadata_options`
- `agent_get_pravachan` → `POST /api/agent/get_pravachan`

---

## 2) Expected result objects & citation fields

The agent API returns **ordered “chunks”**. Each chunk includes:
- `text_content` (the passage)
- `metadata` containing (at minimum; exact fields per OpenAPI):
  - `chunk_id`
  - `category` (Granth/Pravachan)
  - `granth`
  - `anuyog`
  - `language` (`hi` or `gu`)
  - `page_number`
  - `file_url` (short URL)
  - plus optional fields (e.g., contributor, pravachan info)

### What to show the user

When citing or listing sources, show:
- `granth` and/or `category`
- `page_number`
- `file_url` (short URL)

Never show:
- `chunk_id`

---

## 3) Usage guidelines (hard rules)

These are “must follow” constraints (ported from MCP guidelines):

1) Prefer **page 1** results from `agent_search`, since they are typically the best match.
2) Use `agent_get_filter_options` **only before** the initial search in a session, and **only when** you need exact filter values (granth/anuyog/contributor or Pravachan date ranges).
3) Never add `chunk_id`(s) in the answer.

---

## 6) Practical retrieval patterns

### Pattern A: Search → Navigate (most common)
- Run `agent_search`.
- Pick the most relevant chunk(s).
- Run `agent_navigate` with `direction="both"` and `steps=1..5` to capture surrounding context.
- Answer using merged context, citing pages/URLs.

### Pattern B: Seed chunk → Find Similar (breadth across corpus)
- After a strong seed chunk, use `agent_find_similar` to retrieve related passages from other documents.
- Use this to compare how multiple texts discuss the same concept.

### Pattern C: Known Pravachan → Get full discourse
- Use `agent_get_pravachan` when you already have a `pravachan_number` and the user needs the full discourse.

### Pattern D: Filters discovery (only if needed)
- Call `agent_get_filter_options` only when you must populate an exact `granth`/`anuyog`/`contributor` filter value and you cannot safely guess it.

### Pattern E: Metadata combinations (author ↔ granth ↔ anuyog)
- Call `agent_get_metadata_options` to get unique `{granth, author, anuyog}` tuples for a given language and content type, plus a `url` field containing the short URL (or empty string if unavailable).
- Use this when you need explicit mappings (for example, which authors are associated with which granths).

---

## 7) API contract notes (important for navigation)

Chunk IDs look like:
- `{uuid}_p{page}_para{paragraph_id}`

`paragraph_id` is sequential within a document, enabling navigation.

`agent_navigate(direction="both", steps=1)` returns:
- `[prev, current, next]` (a small context window)

The `contributor` filter is unified internally (Author OR Tikakaar OR Bhasha Vachanika). Agents don’t need to know the role—just pass the string.

`agent_search` notes:
- `page_size` max is **50**
- `rerank=true` (default in most clients) applies a cross-encoder reranking step (slower but typically more relevant)

---

## 8) Example tool call templates

All bodies are JSON and should validate against the OpenAPI spec.

### 8.1 Focused search
```json
{
  "query": "सम्यग्दर्शन का स्वरूप",
  "language": "hi",
  "content_type": "both",
  "rerank": true,
  "page_size": 10,
  "page": 1
}
```

### 8.2 Search with optional filters (example)
```json
{
  "query": "जीव अजीव द्रव्य",
  "language": "hi",
  "content_type": "Granth",
  "granth": "Samaysaar",
  "anuyog": "Dravyanuyog",
  "contributor": "Pandit Jaychand Chhabbra",
  "page_size": 10,
  "page": 1,
  "rerank": true
}
```

> Note: filter values must match server-supported values. If you’re unsure, fetch them using `agent_get_filter_options` first.

### 8.3 Navigate a context window
```json
{
  "chunk_id": "a1b2c3_p12_para4",
  "direction": "both",
  "steps": 2
}
```

### 8.4 Find similar passages
```json
{
  "chunk_id": "a1b2c3_p12_para4"
}
```

### 8.5 Fetch filter options (only if needed before initial search)
```json
{
  "language": "hi",
  "content_type": "Granth"
}
```

### 8.6 Fetch entire Pravachan
```json
{
  "granth": "Samaysaar",
  "pravachan_number": "93",
  "language": "hi"
}
```

### 8.7 Fetch metadata combinations
```json
{
  "language": "hi",
  "content_type": "Granth"
}
```

---

## 9) Agentic Integration notes (Gemini / OpenAI / LangChain) - Through tools framework

### 9.1 Gemini (function calling)
- Define each tool as a function whose JSON schema matches the OpenAPI request body.
- Implement a tool handler that:
  1) HTTP POSTs to the endpoint
  2) returns parsed JSON to the model
- Put **Sections 1, 4, 5** (prompt + workflow + hard rules) in the system instruction.

### 9.2 OpenAI / compatible “tools”
- Each endpoint becomes a tool with `name` matching the mapping in Section 2.
- Return values should be the raw JSON (array of chunks).

### 9.3 LangChain
- Implement each endpoint as a `StructuredTool`.
- Enforce hard rules in system prompt.

---

## 10) Minimal “tool-call contract” (for non-MCP agents)

When using CatalogueSearch, the agent can:
1) Perform retrieval using `agent_search` (and expansions via `agent_navigate` / `agent_find_similar` / `agent_get_pravachan`).
2) Build answers only from retrieved `text_content`.
3) Attach citations derived from chunk metadata (`granth/category`, `page_number`, `file_url`).
4) Omit internal identifiers (never show `chunk_id`).
