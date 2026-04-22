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
GEMINI_API_KEY=your-gemini-key-here
```

### Using OpenAI instead of Gemini

```env
# service/.env.local
EXTERNAL_API_BASE_URL=https://swalakshya.me
OPENAI_API_KEY=your-openai-key-here
```

### Run locally
```
cd service
npm install
npm start
```

### Run Tests

Unit tests:

```bash
cd service
npm test
```

Integration tests spin up an in-process server automatically. Create `service/.env.test` with:

```env
TEST_MODE=true
TEST_MIN_SAMPLES=2
```

Then run:

```bash
cd service
node --env-file=.env.test --test
```

### Docker (preferred)

```bash
cp service/.env.local.example service/.env.local
# Edit service/.env.local with your API key and backend URL
docker compose up
```

## All environment variables

| Variable | Default | Description |
|---|---|---|
| `EXTERNAL_API_BASE_URL` | `http://localhost:8000` | CatalogueSearch backend URL |
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
| `LOG_LEVEL` | `info` | Console log level (`info`, `verbose`, `debug`) |
| `LOGS_DIR` | — | When set, writes JSON lines to `info.log` and `verbose.log` |
| `CHAT_DB_PATH` | — | When set, enables SQLite-backed session persistence, feedback storage, and request logs |

## Session Persistence
- SQLite-backed storage is optional and enabled only when `CHAT_DB_PATH` is set.
- The Docker compose setup mounts `/app/data` and sets `CHAT_DB_PATH=/app/data/cataloguesearch-chat.db`.
- The shared SQLite file stores `sessions`, `feedback`, and `request_logs`.
- Live sessions stay in memory while active; SQLite is used for restore after eviction or restart.

## Logging
- `info.log` captures operational events at `info`, `warn`, and `error`.
- `verbose.log` captures everything in `info.log` plus payload-heavy `verbose` traces such as request/response bodies.
- When `LOGS_DIR` is unset, logs go only to stdout/stderr.

In Docker, the compose file mounts named volumes at `/app/logs` and `/app/data`, so the chat service keeps logs plus the shared SQLite database outside the container lifecycle.

## Configs

Workflow tuning lives in `service/src/config/model_config.js` under `workflowDefaults` and per-model `workflowOverrides`.
Example structure:
```js
const MODEL_ROUTING_CONFIG = {
  workflowDefaults: {
    basic: { page: 1, page_size: 15, rerank: true },
    followup: {
      page: 1,
      page_size: 10,
      rerank: true,
      navigate_steps: 3,
      navigate_direction: "both",
      expand_limit: 10,
    },
    advanced_distinct: { page: 1, page_size: 10, rerank: true },
    advanced_nested: { page: 1, page_size: 10, rerank: true },
  },
  models: [
    {
      id: "gemini-2.5-flash",
      provider: "gemini",
      priority: 1,
      workflowOverrides: {}, // empty = use defaults
    },
    {
      id: "gpt-4o",
      provider: "openai",
      priority: 3,
      workflowOverrides: {
        followup: { expand_limit: 5 },
      },
    },
  ],
};
```
`workflowOverrides` is merged over `workflowDefaults` by key, so you can override only the fields you need without redefining the full config.

Defaults in `src/config/token_limits.js`, Example:
```json
{
  "openai": { "gpt-4o": 128000, "*": 120000 },
  "gemini": { "gemini-2.5-pro": 1048576, "gemini-2.5-flash": 1048576 },
  "default": { "*": 120000 }
}
```

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
