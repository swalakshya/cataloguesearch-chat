# Answer Synthesis

**MUST FOLLOW:**
- Output JSON only (no prose/markdown).
- Follow answer language section.
- Keep answer simple and grounded in context; no guess.
- No tables.
- Include at least 1 direct quote as inline citation.
- Always include follow-up section and references section.
- Do not include chunk_id values in answer text.
- Scoring only for used chunk_ids from context (1-100).
- Follow Specific Answering Guidelines section.

## User Question
<QUESTION_HERE>

---
## Formatting Rules (WhatsApp style, Must follow)
- New line: \n
- Inline code: `text` (for important words and granth mentions)
- Bold: *text* (for not so important keywords and headings)
- Italic: _text_ (for author/contributor/acharya mentions)
- Inline citation: **always** start with "> " and include quote + reference on that line, format-
  E.g:
> इसको मैं करता हूँ, यह कर्मचेतना है| (समयसार, पृष्ठ 57)
- Ensure a single \n before and after the inline citation line. No space before ">". No new lines inside the citation.
- Lists should be bulled, each item as "- {item}". Headings should not be bulleted.

Follow-up section:
- Starts with italic line: "_If you want I can answer this in detail or I can also answer -_"
- 2-3 relevant questions as bulleted list, each as "- {q1}"
- follow‑ups must be unique and not repeat history questions but grounded on the context

References section:
- Heading "References"
- Numbered list: "1. source, Page N, file_url + "/" + N" (N is page_number) (e.g. https://ab.com/64) 
- Translate granth name/page text to answer language (links stay as-is)

---
## Citation/References counts (Must follow)
- Follow the *Specific Answering Guidelines* for counts.
- If it does not specify counts, use:
  - min 1 and up to *5* max inline citations total, don't add more.
  - min 1 and up to *5* max references total, don't add more.
- Provide most relevant references first in the references section.

---
## Output Contract (JSON only)
{
  "answer": "<full answer text including citations, follow-ups, references>",
  "scoring": [ { "chunk_id": "<id>", "score": 1 }, ... ]
}

SCORING:
- include only used chunk_ids
- score is integer 1-100

---
## Answer Language (`answer` param in output)
- Language: <LANGUAGE_HERE>
- Script: <SCRIPT_HERE>
(If user asks a particular language in the user-question, Ignore these.)

---
## If insufficient or conflicting context or unsure
Return `NO_ANSWER` as the value of the `answer` field.

---
## Context Field Mapping
- id: chunk_id
- u: file_url
- p: page_number
- g: source
- a: author
- t: text_content

---
## Current Context
<CONTEXT_HERE>
