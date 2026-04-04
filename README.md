# cataloguesearch-chat

AI chat components for [CatalogueSearch](https://github.com/swalakshya/cataloguesearch) — a search engine for Jain scripture (Jainagam), available at [swalakshya.me](https://swalakshya.me).

This repository lets you build a chatbot on top of the CatalogueSearch corpus. You can point it at the **live production API** (`swalakshya.me`) or run it against a **local instance** of the backend.

---

## What it does

CatalogueSearch indexes thousands of pages from Jain Granths and Books. This repo provides two components that sit on top of that index and enable conversational AI access:

- **`service/`** — A Node.js REST service that manages multi-turn chat sessions. When a user asks a question, it extracts keywords using an LLM, searches the CatalogueSearch corpus, and synthesises a cited answer. Supports OpenAI and Gemini.

- **`mcp/`** — A Python [MCP server](https://modelcontextprotocol.io/) that exposes CatalogueSearch as tools for Claude Desktop or any MCP-compatible AI agent.

Both components call the CatalogueSearch backend API (`/api/agent/`) and require only an LLM API key to run.

---

## Chat Service (`service/`)

The service starts on port `8012` and exposes:
- `POST /v1/chat/sessions` — create a session
- `POST /v1/chat/sessions/:id/messages` — send a message
- `GET  /v1/health` — health check

### Prerequisites
- Node.js 20+
- An OpenAI or Gemini API key
- A running CatalogueSearch backend (prod or local — see below)

### Setup

```bash
cd service
cp .env.local.example .env.local
# Edit .env.local with your API key and backend URL
npm install
npm start
```

### Using the production API (swalakshya.me)

```env
# service/.env.local
EXTERNAL_API_BASE_URL=https://swalakshya.me
LLM_PROVIDER=gemini
LLM_MODEL=gemini-2.5-flash
GEMINI_API_KEY=your-gemini-key-here
```

### Gemini API key via Google Secret Manager (optional)
If `GEMINI_API_KEY` (or `GOOGLE_API_KEY` / `LLM_API_KEY`) is **not** set, the service will fetch the Gemini key from Google Cloud Secret Manager.

Required env vars:
- `GCP_PROJECT_ID`
- `GCP_SECRET_NAME`
- `GCP_SA_KEY_PATH`
- `GCP_SECRET_VERSION` (optional, default: `latest`)

Mount the service account JSON key file read-only into the container.

### Using a local backend

```env
# service/.env.local
EXTERNAL_API_BASE_URL=http://localhost:8000
LLM_PROVIDER=gemini
LLM_MODEL=gemini-2.5-flash
GEMINI_API_KEY=your-gemini-key-here
```

### Using OpenAI instead of Gemini

```env
# service/.env.local
EXTERNAL_API_BASE_URL=https://swalakshya.me
LLM_PROVIDER=openai
LLM_MODEL=gpt-4o
OPENAI_API_KEY=your-openai-key-here
```

### Run locally
```
cd service
npm install
npm start
```

### Docker (preferred)

```bash
cp service/.env.local.example service/.env.local
# Edit service/.env.local with your API key and backend URL
docker compose up
```

### All environment variables

| Variable | Default | Description |
|---|---|---|
| `EXTERNAL_API_BASE_URL` | `http://localhost:8000` | CatalogueSearch backend URL |
| `LLM_PROVIDER` | `openai` | `openai` or `gemini` |
| `LLM_MODEL` | `gpt-4o` | Model name |
| `OPENAI_API_KEY` | — | Required if using OpenAI |
| `GEMINI_API_KEY` | — | Required if using Gemini |
| `GCP_PROJECT_ID` | — | Google Cloud project id (Secret Manager) |
| `GCP_SECRET_NAME` | — | Secret name storing Gemini API key |
| `GCP_SECRET_VERSION` | `latest` | Secret version |
| `GCP_SA_KEY_PATH` | — | Service account JSON key path (container) |
| `LLM_SERVICE_PORT` | `8012` | Port the service listens on |
| `LLM_SESSION_IDLE_TIMEOUT_SEC` | `900` | Session idle timeout (seconds) |
| `WORKFLOW_TOOL_CALL_BUDGET` | `25` | Max API calls per request |
| `LLM_SESSION_TOKEN_LIMIT` | — | Explicit per-session token limit (overrides mapping) |
| `LLM_SESSION_TOKEN_LIMIT_THRESHOLD` | `0.8` | % of limit after which requests are rejected |
| `LLM_TOKEN_LIMITS_JSON` | — | JSON map of token limits by provider/model |
| `GREETING_CONTACT_EMAIL` | `projectjinam@gmail.com` | Email shown in greeting response |
| `WF_BASIC_PAGE` | `1` | basic workflow search page |
| `WF_BASIC_PAGE_SIZE` | `15` | basic workflow page size |
| `WF_BASIC_RERANK` | `true` | basic workflow rerank |
| `WF_FOLLOWUP_PAGE` | `1` | followup workflow search page |
| `WF_FOLLOWUP_PAGE_SIZE` | `10` | followup workflow page size |
| `WF_FOLLOWUP_RERANK` | `true` | followup workflow rerank |
| `WF_FOLLOWUP_NAVIGATE_STEPS` | `3` | followup workflow navigate steps |
| `WF_FOLLOWUP_NAVIGATE_DIRECTION` | `both` | followup workflow navigate direction |
| `WF_FOLLOWUP_EXPAND_LIMIT` | `10` | followup workflow expand cap |
| `WF_ADV_DISTINCT_PAGE` | `1` | advanced distinct workflow search page |
| `WF_ADV_DISTINCT_PAGE_SIZE` | `10` | advanced distinct workflow page size |
| `WF_ADV_DISTINCT_RERANK` | `true` | advanced distinct workflow rerank |
| `WF_ADV_NESTED_PAGE` | `1` | advanced nested workflow search page |
| `WF_ADV_NESTED_PAGE_SIZE` | `10` | advanced nested workflow page size |
| `WF_ADV_NESTED_RERANK` | `true` | advanced nested workflow rerank |

---

## MCP Server (`mcp/`)

Exposes CatalogueSearch search tools to Claude Desktop or any MCP-compatible client.

### Prerequisites
- Python 3.10+
- A running CatalogueSearch backend (prod or local)

### Setup

```bash
cd mcp
pip install -r requirements.txt
```

#### Run locally using the production API

```bash
EXTERNAL_API_BASE_URL=https://swalakshya.me python mcp_server.py
```

#### Run locally using a local backend

```bash
EXTERNAL_API_BASE_URL=http://localhost:8000 python mcp_server.py
```

### Claude Desktop configuration

Add to your `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "cataloguesearch": {
      "disabled": false,
      "timeout": 600,
      "type": "stdio",
      "command": "python",
      "args": ["/path/to/cataloguesearch-chat/mcp/mcp_server.py"],
      "env": {
        "EXTERNAL_API_BASE_URL": "https://swalakshya.me"
      }
    }
  }
}
```

### Cline:
Add to your `cline_mcp_settings.json`:

```json
{
  "mcpServers": {
    "cataloguesearch": {
      "disabled": false,
      "timeout": 600,
      "type": "stdio",
      "command": "python",
      "args": ["/path/to/cataloguesearch-chat/mcp/mcp_server.py"],
      "env": {
        "EXTERNAL_API_BASE_URL": "https://swalakshya.me"
      }
    }
  }
}
```

#### Notes on Claude/Cline compatibility

Claude/Cline’s MCP server runner does **not** expand `~` in `args`. Use an **absolute path** to `mcp_external_api_server.py` in your Cline MCP settings.


### OpenAI Codex (MCP stdio)
Add to `~/.codex/config.toml`:

```toml
[mcp_servers.cataloguesearch]
type = "stdio"
command = "python"
startup_timeout_sec = 60
args = [
  "/path/to/cataloguesearch-chat/mcp/mcp_server.py"
]

[mcp_servers.cataloguesearch.env]
EXTERNAL_API_BASE_URL = "https://swalakshya.me"
EXTERNAL_API_VERIFY_TLS = "false"
```

## Environment Variables
- `EXTERNAL_API_BASE_URL`: API base URL (default `http://localhost:8000`)
- `EXTERNAL_API_VERIFY_TLS`: `true` or `false` to override TLS verification
- `EXTERNAL_API_TIMEOUT`: HTTP timeout in seconds (default `120`)

---

## Related

- [cataloguesearch](https://github.com/swalakshya/cataloguesearch) — the main backend and frontend
- [swalakshya.me](https://swalakshya.me) — live search UI
