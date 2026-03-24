# LLM Direct Service

Deterministic, non-agentic LLM service for CatalogueSearch. It calls LLM providers directly and orchestrates a fixed retrieval + answer workflow using the External API.

## Endpoints
- `POST /v1/chat/sessions`
- `POST /v1/chat/sessions/{id}/messages`
- `GET /v1/chat/sessions/{id}`
- `DELETE /v1/chat/sessions/{id}`
- `GET /v1/health`

## API Contracts

### `POST /v1/chat/sessions`
Request:
```json
{
  "provider": "openai|gemini",
  "language": "hi|gu|en"
}
```

Response:
```json
{
  "session_id": "uuid",
  "provider": "openai|gemini"
}
```

### `POST /v1/chat/sessions/{id}/messages`
Request:
```json
{
  "role": "user",
  "content": "string",
  "filters": {
    "content_type": "Granth|Pravachan|both",
    "granth": "string",
    "anuyog": "string",
    "contributor": "string",
    "year_from": 1990,
    "year_to": 2024
  }
}
```

Filtering behavior:
- UI-provided `filters` are merged with LLM-extracted filters from Step 1.
- UI filters take precedence when the same field is present.
- When no UI filters are supplied, only LLM-extracted filters are used.

Response:
```json
{
  "answer": "string",
  "references": ["string"],
  "citations": [
    {
      "granth": "string",
      "category": "string",
      "page_number": 123,
      "file_url": "string"
    }
  ],
  "provider": "openai|gemini",
  "tool_trace_id": "uuid",
  "warnings": ["string"] | null
}
```

### `GET /v1/chat/sessions/{id}`
Response:
```json
{
  "session_id": "uuid",
  "provider": "openai|gemini",
  "language": "hi|gu|en",
  "created_at": 1710000000,
  "last_activity_at": 1710000123,
  "messages": [
    { "role": "user", "content": "string" },
    { "role": "assistant", "content": "string" }
  ]
}
```

### `DELETE /v1/chat/sessions/{id}`
Response:
```json
{ "status": "closed" }
```

## Requirements
- Node.js 20+
- Access to CatalogueSearch External API
- LLM provider API key (OpenAI supported now)

## Quick Start
```
cd llm_direct_service
npm install

export OPENAI_API_KEY=YOUR_KEY
export EXTERNAL_API_BASE_URL=http://localhost:8000

npm start
```

### Gemini Quick Start
```
cd llm_direct_service
npm install

export LLM_PROVIDER=gemini
export GEMINI_API_KEY=YOUR_KEY
export LLM_MODEL=gemini-2.0-flash
export EXTERNAL_API_BASE_URL=http://localhost:8000

npm start
```

## Environment Variables
- `LLM_SERVICE_PORT` (default `8012`)
- `LLM_PROVIDER` (default `openai`)
- `LLM_MODEL` (default `gpt-4o`)
- `OPENAI_API_KEY` (or `LLM_API_KEY`)
- `OPENAI_BASE_URL` (optional)
- `GEMINI_API_KEY` (or `GOOGLE_API_KEY` or `LLM_API_KEY`)
- `GEMINI_RESPONSE_MIME_TYPE` (optional, default `application/json` for JSON-only keyword extraction)
- `LLM_JSON_MODE` (default `true`)
- `LLM_REQUEST_TIMEOUT_SEC` (default `120`)
- `LLM_TEMPERATURE` (default `0.75`)
- `EXTERNAL_API_BASE_URL` (default `http://localhost:8000`)
- `EXTERNAL_API_TIMEOUT_SEC` (default `60`)
- `WORKFLOW_TOOL_CALL_BUDGET` (default `25`)
- `LLM_SESSION_IDLE_TIMEOUT_SEC` (default `900`)
- `LOG_LEVEL` (`error|warn|info|debug`)

## Docker
```
docker build -t llm-direct-service ./llm_direct_service

docker run --rm \
  -p 8012:8012 \
  -e OPENAI_API_KEY=YOUR_KEY \
  llm-direct-service
```

### Docker (Gemini)
```
docker build -t llm-direct-service ./llm_direct_service

docker run --rm \
  -p 8012:8012 \
  -e LLM_PROVIDER=gemini \
  -e GEMINI_API_KEY=YOUR_KEY \
  -e LLM_MODEL=gemini-2.5-flash \
  llm-direct-service
```

## Notes
- Workflow prompts live under `llm_direct_service/prompts/`.
- External API schemas live under `tools/external_api_openapi.*`.
- This service uses deterministic retrieval workflows defined in `llm_direct_service/docs/workflow_implementation_details.md`.
