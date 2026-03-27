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

## Notes
- Workflow prompts live under `llm_direct_service/prompts/`.
- External API schemas live under `tools/external_api_openapi.*`.
- This service uses deterministic retrieval workflows defined in `llm_direct_service/docs/workflow_implementation_details.md`.
