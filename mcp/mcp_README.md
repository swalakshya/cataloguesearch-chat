# MCP External API Server (stdio)

This MCP server connects agentic AI clients (Cline, Claude Desktop, OpenAI Codex, etc.) to the **CatalogueSearch External API**, which is implemented by the FastAPI backend in this repository (`backend/api/external_api.py`).

It speaks **MCP JSON-RPC over stdio** and forwards tool calls to these backend endpoints:

- `POST /api/external/search`
- `POST /api/external/navigate`
- `POST /api/external/find_similar`
- `POST /api/external/get_filter_options`
- `POST /api/external/get_pravachan`

## Repository context (what CatalogueSearch is)

CatalogueSearch is an OpenSearch-backed hybrid search system for multilingual (Hindi/Gujarati) PDF corpora containing Jain scriptures and discourses.

It indexes two primary categories:

- **Granth (Mool Agam)**: Original Jain scriptures written by saints and scholars.
- **Pravachan**: Discourses by Gurudev Shri Kanji Swami (also known as Kahan Guru).

Under the hood (high-level architecture; see `ARCHITECTURE.md`):
- A Discovery/ETL pipeline processes PDFs (OCR, text cleanup, and paragraph generation).
- Content is indexed into OpenSearch for hybrid retrieval (keyword + vector search), with optional reranking.

The backend (`cataloguesearch-api`) exposes a standard web API for the frontend and for programmatic access. This MCP server exists so an AI agent can access the same data via standard MCP tool calls.

## What this MCP server is for

This is a **thin, stateless adapter** that turns the backend’s HTTP endpoints into MCP tools that an agent can call over stdio.

An AI agent can use it to:
- perform searches and retrieve passages (“chunks”),
- apply filters (granth, anuyog, contributor, year ranges) to narrow results,
- navigate sequentially within a document around a known chunk (prev/next paragraphs),
- fetch semantically similar passages given a strong seed chunk,
- discover valid filter values dynamically (no hardcoded enums),
- fetch the full ordered text for a specific numbered Pravachan.

## Prompts (recommended)

This MCP server exposes two prompts:

- `about_cataloguesearch` — basic factual context about the CatalogueSearch corpus and how to interpret chunk metadata.
- `cataloguesearch_answering_guidelines` — operational guidelines for tool usage and for writing grounded answers with citations (loaded from `mcp/backend/guidelines/cataloguesearch_answering_guidelines.md`).

Recommendation: load the **guidelines prompt** into your system context before answering user queries.

## Model usage guidance

Most agents follow prompt text more reliably than README instructions. For best results, load the MCP prompt:
- `cataloguesearch_answering_guidelines`

The README guidance below is a human-readable summary of that prompt:

- Call `external_search` at most once per user question; never repeat the same search to “double check”.
- If more context is needed, expand using `external_navigate` / `external_find_similar` / `external_get_pravachan` (not another search).
- Write readable answers in full sentences.
- Always include citations inline when needed and include a final References section.

## API contract notes (from `api_contract.md`)

- Chunk IDs look like `{uuid}_p{page}_para{paragraph_id}`. `paragraph_id` is sequential within a document, enabling navigation.
- `navigate(direction="both", steps=1)` returns previous + current + next chunks (a context window).
- `contributor` is a unified filter that matches Author OR Tikakaar OR Bhasha Vachanika internally—agents don’t need to know the role.

## What it connects to
- Local API: `http://localhost:8000`
- Production API: `https://<swalakshya-domain>` (set via `EXTERNAL_API_BASE_URL`)

## Run
```bash
python mcp_external_api_server.py --verbose
```

## Environment Variables
- `EXTERNAL_API_BASE_URL`: API base URL (default `http://localhost:8000`)
- `EXTERNAL_API_VERIFY_TLS`: `true` or `false` to override TLS verification
- `EXTERNAL_API_TIMEOUT`: HTTP timeout in seconds (default `120`)

## Tools Exposed
- `external_search` — primary retrieval entrypoint (hybrid search + filters + optional rerank)
- `external_navigate` — fetch surrounding paragraphs by chunk_id
- `external_find_similar` — find semantically related passages starting from one chunk
- `external_get_filter_options` — discover valid filter values (granth/anuyog/contributor/date ranges)
- `external_get_pravachan` — fetch the full ordered text for a numbered Pravachan

Tool payloads mirror `docs/external_api_README.md` and the OpenAPI spec in `docs/tools/external_api_openapi.yaml` (or `.json`).

## Relevant docs
- External API docs: `docs/external_api_README.md`
- OpenAPI spec: `docs/tools/external_api_openapi.yaml` (or `.json`)
- Backend implementation: `backend/api/external_api.py`
- API contract summary: `api_contract.md`

## Notes on Cline compatibility

Cline’s MCP server runner does **not** expand `~` in `args`. Use an **absolute path** to `mcp_external_api_server.py` in your Cline MCP settings.

Also ensure you pass configuration via `env` (recommended) or `--base-url`:
- local docker/dev API: `http://localhost:8000`
- deployed API: `https://<your-swalakshya-domain>`

## Client Config Examples

Claude Desktop (`claude_desktop_config.json`):
```json
{
  "mcpServers": {
    "cataloguesearch": {
      "command": "python",
      "args": ["/absolute/path/to/mcp_external_api_server.py"],
      "env": {
        "EXTERNAL_API_BASE_URL": "http://localhost:8000"
      }
    }
  }
}
```

Cline (VS Code MCP servers):
```json
{
  "mcpServers": {
    "cataloguesearch": {
      "command": "python",
      "args": ["/absolute/path/to/mcp_external_api_server.py"],
      "env": {
        "EXTERNAL_API_BASE_URL": "https://<swalakshya-domain>"
      }
    }
  }
}
```

OpenAI Codex (MCP stdio) — add to `~/.codex/config.toml`:
```toml
[mcp_servers.cataloguesearch]
type = "stdio"
command = "python"
startup_timeout_sec = 60
args = [
  "/absolute/path/to/mcp_external_api_server.py"
]

[mcp_servers.cataloguesearch.env]
EXTERNAL_API_BASE_URL = "http://localhost:8000"
EXTERNAL_API_VERIFY_TLS = "false"
```
