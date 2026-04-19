# Keyword Extraction + Workflow Selection

**MUST FOLLOW:**
- Output JSON only (no prose/markdown).
- Follow the schema exactly and include required fields.
- Keywords in Hindi (Devanagari). Simple verbs; keep nouns intact; no duplicate keywords.
- Do not invent keywords if not a part of the question.
- Do not invent filters unless explicitly requested.
- No reasoning.

## User Question
<QUESTION_HERE>

---
## Workflow Catalog

### greeting_message_v1
Use for greetings or chat initiators.
E.g: "Jai Jinendra" or "Hello"

### basic_question_v1
Use for simple definitional/comparative questions.
E.g: "जम्बूस्वामी कोन थे?"

### advanced_distinct_questions_v1
Use for multiple distinct questions.
E.g: "Jeev kya hai aur ajiv kya hai?"

### advanced_nested_questions_v1
Use for main question with sub-questions.
E.g: “आस्रव तत्त्व का स्वरूप क्या है? Kya raag dwesh bhi ashrav me aate hain?”, "शलाका पुरुष कितने है? भेद बताइए"

### followup_question_v1
Use when it references a previous answer from history. Can have three action-intent based types. E.g:
- PureQuestion - "karan parmatma ke bhed batao"
- PureRequest - "aur batao"
- Mixed (mixed question + action) - "karan parmatma ko aur samjhao, ye karya parmatma se kaise bhinna hai?"

### metadata_question_v1
Use for metadata lists or metadata facts about granths, anuyogs, or authors.
E.g: "Acharya kundkund ne konse granth likhe hain?" / "Samaysaar shastra kisne likha hai?" / "Charnanuyoga ke kuch granth bataiye"

---
## RULES (ordered)
1) Normalize question to Hindi (Devanagari) for keywords. Keep original language/script in output. Handle typos/slang/emoji/mis-spell/sms-language by normalization.
2) If greeting: workflow=greeting_message_v1, set language/script, is_followup=false, stop.
3) If metadata question: set workflow=metadata_question_v1, add `asked_info` (allowed: granth, anuyog, author, link; always include granth), stop.
4) Extract explicit filters (granth/anuyog/contributor). If none, inherit from history. If user removes/changes, clear filters {}. Filters must be English.
5) Determine is_followup and action intent.
6) If is_followup=true:
   - workflow=followup_question_v1
   - followup_keywords from matched history sets
   - expand_chunk_ids: up to 5 (highest score first)
   - PureQuestion/Mixed: classify into basic/distinct/nested and add keywords/queries/main_query+sub_queries respectively
   - PureRequest: skip
7) If is_followup=false: select best workflow and fill keywords/queries/main_query accordingly.

---
## OUTPUT JSON (no prose)
Base fields:
{
  "language": "hi|en",
  "script": "latin|devanagari",
  "workflow": "<workflow_id>",
  "filters": { # skip if metadata_question_v1
    "granth": "<optional>", #en
    "anuyog": "<optional>", #en
    "contributor": "<optional>", #en
    "content_type": <DEFAULT_CONTENT_TYPES_JSON> #fixed default, allowed values: <ALLOWED_CONTENT_TYPES_JSON>
  },
  "is_followup": true|false
}

Workflow-specific fields:
- basic_question_v1: { "keywords": ["..."] }
- advanced_distinct_questions_v1: { "queries": [ { "id": "q1", "keywords": ["..."] } ] }
- advanced_nested_questions_v1: { "main_query": { "keywords": ["..."] }, "sub_queries": [ { "id": "s1", "keywords": ["..."] } ] }
- followup_question_v1: { "followup_keywords": [ { "id": "set_1", "keywords": ["..."] } ], "expand_chunk_ids": ["..."]}
  - basic followup: add keywords similar to basic_question_v1
  - distinct followup: add keywords similar to advanced_distinct_questions_v1
  - nested followup: add keywords similar to advanced_nested_questions_v1
- metadata_question_v1: { "asked_info": ["granth" (**always**), "anuyog", "author", "link"] }
