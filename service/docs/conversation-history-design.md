# Conversation History Design

## Overview
We need step1 and step2 (keyword extraction, answer synthesis) to receive a conversation history that follows a new rule: on any non-followup message, history is trimmed so future messages start a new thread. Step2 behavior remains unchanged (history only on followup).

## Goals
- Step1 receives history based on the latest session state.
- Non-followup messages reset the persisted conversation history.
- Step2 only gets history when `is_followup=true`.

## Non-Goals
- Changing how step2 formats or filters history.
- Changing the history schema or prompt format.

## Current Behavior
- `session.conversationHistory` is always appended with each message set.
- Step1 always gets full `session.conversationHistory`.
- Step2 receives history only when `is_followup=true`.

## Proposed Behavior
1. Step1 uses the current `session.conversationHistory`.
2. After step1 returns:
   - If `is_followup=true`: keep `session.conversationHistory` as-is.
   - If `is_followup=false`: trim `session.conversationHistory` to `[]` before continuing.
3. Step2 remains unchanged: pass history only when `is_followup=true`.
4. After answer synthesis, append the current Q/A set into `session.conversationHistory`.
5. Post-response: if `session.conversationHistory.length` reaches **N** (default 4), fire-and-forget summary compaction replaces the N sets with a single summary set (see below).

This yields:
- Message 1: step1 sees no history.
- Message 2: step1 sees message 1 unless it is marked non-followup (in which case history is trimmed before the answer is generated and before the next message).
- Any non-followup creates a new history thread from that message onward.

## Data Flow Diagram
```
User Message N
   |
   v
Step1 Prompt (uses current session.conversationHistory)
   |
   v
Step1 Output (is_followup?)
   |\
   | \-- if false: session.conversationHistory = []
   |
   v
Workflow + Retrieval
   |
   v
Step2 Prompt (history only if is_followup=true)
   |
   v
Answer + Scoring
   |
   v
Append current Q/A set to session.conversationHistory
   |
   v
If history length reaches N: fire-and-forget summary compaction
```

## Post-Response Summary Compaction
To prevent prompt growth in deep conversations, history is compacted **after the response is sent**:
- Trigger: when `session.conversationHistory.length === N` (default `4`).
- Summary is produced by an async LLM call (no added response latency), in Hindi.
- Summary set format:
  - `question`: `Conversation summary`
  - `answer`: summary text (~1500–2000 tokens, soft target)
- Chunk handling for the summary set:
  - For each of the N sets, keep top **C** chunks (default `1`) by score.
  - Set all kept scores to **100** and union them into the summary set.
  - If a set has fewer than C chunks, keep all.
- On summary failure, the original N sets are kept.

Config:
- `LLM_HISTORY_SUMMARY_THRESHOLD` (default `4`)
- `LLM_HISTORY_SUMMARY_TOP_CHUNKS` (default `1`)

## Impacted Components
- `service/src/server.js` — post-step1 history trimming.
- Tests that assume full history retention across non-followup messages.

## Testing Strategy
- Add test to ensure history is trimmed on non-followup before the next message.
- Validate step1 prompt history inclusion after a non-followup resets state.
- Confirm step2 history inclusion only on followup remains unchanged.
