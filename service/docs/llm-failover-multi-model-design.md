# LLM Failover + Multi-Model Availability Design

## Summary
Introduce priority-based multi-model routing with a time-based sliding window per model to detect server-side model unavailability. Requests will be routed to the highest-priority available model, failing over on server-side errors. If all models are unavailable, the service returns `503 service_unavailable` without calling any provider.

## Goals
- Support multiple models across providers with priority-based routing.
- Track model availability using a sliding-window failure rate.
- Fail over automatically on server-side/provider-side failures.
- Avoid forwarding requests when no models are available.
- Keep configuration in a hard-coded JSON config for now, but extensible for future models/providers.

## Non-Goals
- Cross-instance shared availability (e.g., Redis-backed circuit state).
- Auto-tuning thresholds or adaptive routing.

## Current State (Brief)
- Single provider/model used per request before failover support.
- Provider instance is created once and used for all requests.
- Errors are mapped to `502/503` in `server.js` based on message strings.

## Proposed Configuration
Hard-coded JSON configuration (in code), later extensible to load from file/env.

```js
const MODEL_ROUTING_CONFIG = {
  windowMs: 15 * 60 * 1000,
  failureRateThreshold: 0.10,
  minSamples: 20,
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
    { id: "gemini-2.5-flash", provider: "gemini", priority: 1 },
    { id: "gemini-3-flash-preview", provider: "gemini", priority: 2 },
    { id: "gpt-4o", provider: "openai", priority: 3 },
  ],
};
```

## Architecture Changes
### New Components
1. **ModelRegistry**
   - Maintains list of models with provider + priority.
   - Exposes `getOrderedModels()` and `getModel(id)`.

2. **ModelAvailabilityTracker**
   - In-memory sliding window per model.
   - Tracks `{ ts, isFailure }` events in a ring buffer or array.
   - `record(modelId, isFailure)`
   - `isAvailable(modelId)`:
     - prune events older than `windowMs`
     - if total < `minSamples` → available
     - else compute failure rate and compare to threshold

3. **ProviderFactory**
   - Builds provider instances for `(providerId, modelId)`.
   - Reuses shared config (API key, timeouts, json mode).
   - Allows per-model overrides without reusing global singleton.
   - Uses a shared secret manager for all model API keys (single service account file; one secret per model name).

### Routing Flow (Per Request)
1. Read ordered model list by priority.
2. Filter to models that are currently `isAvailable`.
3. If none: return `503 service_unavailable` immediately.
4. Attempt request with each model in order:
   - Create provider for that model.
   - Execute workflow (keyword extract → workflow router → answer synthesis).
   - Resolve model-specific prompt root for step1/step2/workflow before each attempt.
   - On success: record success and return.
   - On server-side failure: record failure and try next model.
   - On client-side failure: return error immediately and do **not** record as model failure.

### Model-Specific Prompts
- Prompt roots are resolved per model, using the model id suffix (`prompts_v2_<modelId>`).
- Each failover attempt re-runs step1/step2 with the **new model’s prompt root**.
- Missing files in the model-specific folder fall back to the base prompt root.

### Model-Specific Workflow Config
- Workflow tuning values live in `src/config/model_config.js` under `workflowDefaults`.
- Individual models can override via `workflowOverrides` (same shape as defaults).
- The workflow router passes `modelId` to workflow runners so the merged config applies per attempt.

### Error Classification
Add a helper to classify provider errors:
- **Server-side failures** (count in failure window, trigger failover):
  - Provider HTTP 5xx
  - Gemini `UNAVAILABLE`, `RESOURCE_EXHAUSTED`, or similar busy errors
  - OpenAI 503/529
  - Timeouts/network errors
- **Client-side failures** (no failover, no window impact):
  - Auth errors (401/403)
  - Bad request/validation errors
  - Missing API keys

## Data Flow (Updated)
```
User -> /v1/chat/sessions/{id}/messages
  -> attempt model A (priority 1)
     -> keyword extraction
     -> workflow
     -> answer synthesis
  -> if server-side failure: mark failure, attempt model B
  -> if success: mark success, return answer
  -> if all models unavailable: 503 service_unavailable (no provider call)
```

## Error Responses
- `503 service_unavailable`: all models unavailable at request start.
- Existing `503 provider_unavailable` / `model_temporarily_unavailable` mapped from provider errors.
- Client-side errors still map to 4xx/500 as before (no retries).

## Logging
Add structured logs:
- `model_routing_start` (requestId, candidateModels)
- `model_routing_attempt` (requestId, modelId, provider)
- `model_routing_failure` (requestId, modelId, classifiedType)
- `model_routing_success` (requestId, modelId, latency)
- `model_availability_status` (modelId, total, failures, failureRate, available)

## Testing
### Unit Tests
- Sliding window pruning and failure rate threshold logic.
- Minimum sample size behavior.
- Priority routing order.
- All models unavailable => no provider invocation.
- Error classification categories.

### Integration Tests (lightweight)
- Simulate server-side failures and ensure failover.
- Simulate client-side errors and ensure no failover.

## Rollout Plan
1. Implement config, registry, availability tracker, and routing logic.
2. Deploy behind a feature flag if needed.
3. Observe error rates and failover metrics.
4. Iterate on thresholds.

## Open Questions
None.
