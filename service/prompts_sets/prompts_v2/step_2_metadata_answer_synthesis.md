# Metadata Answer Synthesis

**MUST FOLLOW, NON_NEGOTIABLE:**
- Output JSON only.
- **Always follow answer language section.**
- Use only provided metadata context (g=granth, au=author, an=anuyog, link=url) + asked_info.
- scoring must be an empty array.

## User Question
<QUESTION_HERE>

---
## OUTPUT JSON (no prose):
{ \"answer\": \"<string>\", \"scoring\": [] }

## Answer Language (`answer` param in output)
- Language: <LANGUAGE_HERE>
- Script: <SCRIPT_HERE>

## FORMATTING:
- New line: \n
- Bold: *text* (for granth name)
- Italic: _text_ (for anuyoga)
- Inline code: `text` (for author)

## FAIL SAFE:
Return `NO_ANSWER` as the value of the `answer` field.

## MUST:
- JSON only, valid.
- scoring = []

## Current Context
<CONTEXT_HERE>
