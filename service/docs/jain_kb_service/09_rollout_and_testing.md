# Phase 9 (chat) — Rollout & Testing

## Rollout order

Phases can land in this order with `KB_ENHANCE_ENABLED=false` until each is
verified:

1. Phase 1 (Step1 schema) — safe behind default values.
2. Phase 8 (config + master flag) — wiring with no effect at false.
3. Phase 2 (keyword resolve) — flip `KB_ENHANCE_KEYWORD_RESOLVE=true` after
   kb Phase 1 is live.
4. Phase 5 (metadata) — flip after kb Phase 3.
5. Phase 3 (topic match) — flip after kb Phase 2 + Phase 5.
6. Phase 7 (definitions) — flip after Phase 3 lands.
7. Phase 4 (guided filters) — flip after cataloguesearch agent API ships
   the contract update.
8. Phase 6 (sub-workflows) — flip after kb Phase 4.

## Test pyramid

### Unit (node:test)

- `kb_api/client.test.js` — request shape, timeout, retry.
- `orchestrator/kb_keyword_check.test.js` (Phase 2).
- `orchestrator/kb_topic_match.test.js` (Phase 3 merge).
- `orchestrator/kb_guided_filters.test.js` (Phase 4 derivation).
- `orchestrator/kb_subworkflows.test.js` (Phase 6 dispatch).
- `orchestrator/kb_definitions.test.js` (Phase 7).

### Integration (docker compose)

Add `test/integration/kb_*.test.js`:

1. **Golden chat session — basic question with jain term.**
   Verifies: kb resolve fires, canonical rewrite happens, topic extracts
   in Step2 context, definitions in Step2 context.
2. **Golden chat session — direct retrieval gatha.**
   Verifies: Step1 returns `direct_retrieval` sub-workflow, kb gatha
   detail injected.
3. **Golden chat session — guided filters.**
   Verifies: agent API receives `guided_filters[]`, `guided_results[]`
   appear in Step2 prompt.
4. **kb down — graceful degradation.**
   kb mock returns 500 on every call; chat still produces an answer using
   only cataloguesearch.
5. **Backward compat — old agent API.**
   Agent API mock omits `guided_results`; chat still answers.

Stub kb-service with a small Express mock under
`test/test_support/kb_mock.js` (mirroring `test/test_support/agent_api_mock.js`).

### Manual testing

Add `service/docs/jain_kb_service/manual_testing.md` with curl commands for:

- Creating a session with `KB_ENHANCE_ENABLED=true`.
- Asking each of the three sub-workflow questions.
- Asking a question whose jain keyword has a typo (verifies fuzzy
  suggestions land in Step1b).

## Observability hooks

- Add `kb_call_count`, `kb_call_total_ms`, `kb_call_error_count` to the
  existing per-request structured log line.
- A new debug endpoint `GET /v1/debug/kb-stats` (test-mode only) exposes
  per-endpoint counters so integration tests can assert call shape.

## DoD

- [ ] All five integration scenarios run green in docker compose.
- [ ] Master flag verifiably no-ops kb calls when false.
- [ ] Per-phase flags allow staged enablement.
- [ ] Manual testing doc published.
