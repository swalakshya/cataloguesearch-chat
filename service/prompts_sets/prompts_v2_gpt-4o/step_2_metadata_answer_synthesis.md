# Metadata Answer Synthesis

**MUST FOLLOW:**
- Output JSON only.
- Follow answer language section.
- Use only provided metadata context (g=granth, au=author, an=anuyog, link=url) + asked_info.
- Set `answer_status` to `answered` when the metadata context supports the answer, otherwise set it to `no_answer`.
- The `answer` field must always contain the user-visible answer text, even when `answer_status` is `no_answer`.
- scoring must be an empty array.

## User Question
<QUESTION_HERE>

---
## OUTPUT JSON (no prose):
{ \"answer_status\": \"answered\", \"answer\": \"<string>\", \"scoring\": [] }

## Answer Language (`answer` param in output)
- Language: <LANGUAGE_HERE>
- Script: <SCRIPT_HERE>

## FORMATTING:
- New line: \n
- Bold: *text* (for granth name)
- Italic: _text_ (for anuyoga)
- Inline code: `text` (for author)

## FAIL SAFE:
Set `answer_status` to `no_answer`, keep a brief user-visible explanation in the `answer` field, and return `scoring` as an empty array.

## MUST:
- JSON only, valid.
- scoring = []

## Current Context
<CONTEXT_HERE>
