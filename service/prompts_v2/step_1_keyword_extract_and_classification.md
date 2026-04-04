# Keyword Extraction + Workflow Selection

**MUST FOLLOW, NON_NEGOTIABLE:**
- Output correctly, every output will be reviewed in detail manually and by other ai agents.
- Output JSON only. No prose, no markdown.
- Follow the output schema exactly and include required base fields.
- Keywords must be in Hindi and in Devanagari. Add simple keywords. Don't add multiple keywords for same word.
- Do not invent filters that are not explicitly requested.
- language/script must reflect the user question language/script.
- Do not output reasoning.

## User Question
<QUESTION_HERE>

---
## Workflow Catalog

### greeting_message_v1
Use for greetings or chat initiators.
E.g: "Jai Jinendra" or "Hello"

### basic_question_v1
Use for simple definitional/comparative questions.
E.g: "Atma kya hai?", "जम्बूस्वामी कोन थे?"

### advanced_distinct_questions_v1
Use for multiple distinct questions.
E.g: "Jeev kya hai aur ajiv kya hai?"

### advanced_nested_questions_v1
Use for main question with sub-questions.
E.g: “Ashrav tattva ka swaroop kya hai? Kya raag dwesh bhi isi me aate hain?”, "शलाका पुरुष कितने है? उनके भेद बताइए"

### followup_question_v1
Use when it references a previous answer from history. Can have three action intent based types. Example:
- PureQuestion - "karan parmatma aur karya parmatma me bhed batao"
- PureRequest - "aur batao"
- Mixed (mixed question + action) - "explain the concept of karan parmatma in detail"

### metadata_question_v1
Use for metadata lists or metadata facts about granths, anuyogs, or authors.
E.g: "Acharya kundkund ne konse granth likhe hain?" / "Samaysaar shastra kisne likha hai?" / "Charnanuyoga ke kuch granth bataiye"

---
## RULES (ordered)
1) Question can include misspellings, grammar errors, emojis, and unexpected keywords (normalize them)
2) Normalize question into **Hindi (Devanagari)** for keyword extraction. Keep original language/script in output.
3) If greeting: output workflow=greeting_message_v1 with language, script, is_followup=false. Stop.
4) If the question asks for metadata relations (see `metadata_question_v1`), include `asked_info` array (allowed: granth, anuyog, author, link) [always add granth] and return. No need to proceed further.
5) Extract explicit filters (granth, anuyog, contributor). If none, inherit last filters from history. If user removes/changes, clear filters {}. **Filters must be in english always.**
6) Determine is_followup (relates to history). Determine action intent.
7) If is_followup=true:
   - workflow=followup_question_v1
   - followup_keywords: keywords extracted from matched history sets (questions/answers) 
   - expand_chunk_ids: up to 5 from matched sets (few top chunks from each set basis score) (up to 10, if user asks for more detail in question) 
   - If PureQuestion or Mixed: extract question(s) part (not action) and classify into - basic, distinct or nested followup question. Add `keywords` for basic, `queries` for distnict or `main_query + sub_queries` for nested.
   - Id PureRequest: skip
8) If is_followup=false: select best workflow and fill keywords/queries/main_query accordingly.

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
    "content_type": ["Granth", "Books"] #fixed
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

**MUST:**
- Output JSON only.
- Include required base fields and one workflow-specific field.
- Keywords must be Hindi in Devanagari.
- Do not invent filters.
