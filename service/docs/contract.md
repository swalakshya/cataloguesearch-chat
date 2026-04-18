# Service Contract

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
  "provider": "auto",
  "language": "hi|gu|en"
}
```

Response:
```json
{
  "session_id": "uuid",
  "provider": "auto"
}
```

### `POST /v1/chat/sessions/{id}/messages`
Request:
```json
{
  "role": "user",
  "content": "string",
  "response_format": "structured|combined",
  "filters": {
    "content_type": ["Pravachan", "Granth"],
    "granth": "string",
    "anuyog": "string",
    "contributor": "string"
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
  "follow_up_questions": ["string"],
  "references": ["string"],
  "citations": [
    {
      "granth": "string",
      "category": "string",
      "page_number": 123,
      "file_url": "string",
      "pravachankar": "string",
      "date": "DD-MM-YYYY",
      "pravachan_number": "string",
      "series": "string",
      "series_number": "string",
      "volume": 1,
      "gatha": "string",
      "kalash": "string",
      "shlok": "string",
      "dohra": "string",
      "reference": "string"
    }
  ],
  "provider": "auto|<resolved-provider>",
  "tool_trace_id": "uuid",
  "warnings": ["string"] | null
}
```

`response_format` behavior:
- `structured`: returns `answer` (compacted) plus `follow_up_questions`, `references`, and `citations`.
- `combined` (default): returns a single WhatsApp-ready `answer` string that already includes follow-up questions inline; `follow_up_questions`, `references` and `citations` are omitted.- If `response_format` is omitted, the service uses `DEFAULT_ANSWER_FORMAT` from env or fallbacks to `combined`. Supported env values are `structured` and `combined` (`combined` maps to the single-message combined mode).

### `GET /v1/chat/sessions/{id}`
Response:
```json
{
  "session_id": "uuid",
  "provider": "auto|<resolved-provider>",
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

## Error Responses

| HTTP Status | `detail` | When it happens |
| --- | --- | --- |
| 400 | `provider_not_supported` | Provider must be `auto`. |
| 400 | `invalid_message` | Message payload is invalid (missing role/content or role not `user`). |
| 404 | `session_not_found` | Session ID does not exist. |
| 409 | `session_busy` | Session is already processing another request. |
| 429 | `Token Limit Exhausted for the session. Please initiate a new session.` | Session token limit threshold reached. |
| 429 | `tool_call_budget_exceeded` | Workflow exceeded tool-call budget. |
| 500 | `session_create_failed` | Session creation failed. |
| 500 | `message_failed` | Unhandled error during message processing. |
| 502 | `tool_backend_error` | External API failure. |
| 503 | `provider_unavailable` | LLM provider unavailable. |
| 503 | `model_temporarily_unavailable` | Model overloaded/unavailable (e.g., 503 from provider). |
| 503 | `service_unavailable` | All models unavailable (failover exhausted). |
| 4xx | `client_error` | Client-side error from provider (auth/validation). |

## Notes
- Workflow prompts live under `service/prompts_sets/`.
- External API schemas live under `tools/external_api_openapi.*`.
- This service uses deterministic retrieval workflows defined in `llm_direct_service/docs/workflow_implementation_details.md`.
