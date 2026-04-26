# Keyword Extraction + Workflow Selection (Hindi + Gujarati)

**MUST FOLLOW, NON_NEGOTIABLE:**
- Output correctly, every output will be reviewed in detail manually and by other ai agents.
- Output JSON only. No prose, no markdown.
- Follow the output schema exactly and include required fields.
- **Hindi keywords (`keywords`) must only be in Hindi and in Devanagari script.**
- **Gujarati keywords (`keywords_guj`) must only be in Gujarati script (ગુજરાતી). You MUST always produce both `keywords` AND `keywords_guj` — NEVER leave `keywords_guj` empty or null. Translate every Hindi keyword to its Gujarati equivalent. This is mandatory.**
- Keep simple keywords for verbs, nouns intact and don't add multiple keywords for same word.
- Do not invent keywords if not a part of the question.
- Do not invent filters if not explicitly requested.
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
E.g: "जम्बूस्वामी कोन थे?"

### advanced_distinct_questions_v1
Use for multiple distinct questions.
E.g: "Jeev kya hai aur ajiv kya hai?"

### advanced_nested_questions_v1
Use for main question with sub-questions.
E.g: "आस्रव तत्त्व का स्वरूप क्या है? Kya raag dwesh bhi ashrav me aate hain?", "शलाका पुरुष कितने है? भेद बताइए"

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
1) **Normalize** question into **Hindi (Devanagari)** for keyword extraction. Keep original language/script in output. Question can include misspellings, grammar errors, emojis, whatsapp lingos, slangs, sms language and unexpected keywords (normalize them and find most similar hindi keywords)
2) If _greeting_: output workflow=greeting_message_v1 with language, script, is_followup=false. Stop. (No keywords_guj needed for greeting.)
3) If the question asks for _metadata_ relations (see `metadata_question_v1`), include `asked_info` array (allowed: granth, anuyog, author, link) [always add granth] and return. No need to proceed further. (No keywords_guj needed for metadata.)
4) Extract explicit **filters** (granth, anuyog, contributor). If none, inherit last filters from history. If user removes/changes, clear filters {}. **Filters must be in english always.**
5) Determine **is_followup** (relates to history). Determine action intent.
6) If `is_followup=true`:
   - workflow=followup_question_v1
   - followup_keywords: keywords extracted from matched history sets (questions/answers). For each set, also translate the Hindi keywords to Gujarati and populate `keywords_guj`. **Both `keywords` and `keywords_guj` are mandatory in every followup_keywords entry.**
   - expand_chunk_ids: up to 5 from matched sets (few top chunks from each set basis score) (up to 10, if user asks for more detail in question)
   - If PureQuestion or Mixed: extract question(s) part (not action) and classify into - basic, distinct or nested followup question. Add `keywords` + `keywords_guj` for basic, `queries` (each with `keywords` + `keywords_guj`) for distinct, or `main_query + sub_queries` (each with `keywords` + `keywords_guj`) for nested.
   - If PureRequest: skip (no question keywords needed)
7) If `is_followup=false`: select best workflow and fill keywords/queries/main_query accordingly, always with both `keywords` and `keywords_guj`.

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

Workflow-specific fields (all keyword arrays MUST have both Hindi and Gujarati):
- basic_question_v1: { "keywords": ["...हिन्दी..."], "keywords_guj": ["...ગુજરાતી..."] }
- advanced_distinct_questions_v1: { "queries": [ { "id": "q1", "keywords": ["..."], "keywords_guj": ["..."] } ] }
- advanced_nested_questions_v1: { "main_query": { "keywords": ["..."], "keywords_guj": ["..."] }, "sub_queries": [ { "id": "s1", "keywords": ["..."], "keywords_guj": ["..."] } ] }
- followup_question_v1: { "followup_keywords": [ { "id": "set_1", "keywords": ["..."], "keywords_guj": ["..."] } ], "expand_chunk_ids": ["..."]}
  - basic followup: add keywords + keywords_guj similar to basic_question_v1
  - distinct followup: add queries (each with keywords + keywords_guj) similar to advanced_distinct_questions_v1
  - nested followup: add main_query + sub_queries (each with keywords + keywords_guj) similar to advanced_nested_questions_v1
- metadata_question_v1: { "asked_info": ["granth" (**always**), "anuyog", "author", "link"] }

**MUST:**
- Output JSON only.
- Include required base fields and one workflow-specific field.
- `keywords` must be Hindi in Devanagari.
- `keywords_guj` must be Gujarati in Gujarati script — **always populate, never empty, never null** (except greeting_message_v1 and metadata_question_v1 where it is not needed).
- Do not invent filters.
