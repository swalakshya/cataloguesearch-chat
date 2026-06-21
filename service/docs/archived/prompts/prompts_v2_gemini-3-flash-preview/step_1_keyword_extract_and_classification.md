# Keyword Extraction + Workflow Selection

**MUST FOLLOW, NON_NEGOTIABLE:**
- Output correctly, every output will be reviewed in detail manually and by other ai agents.
- Output JSON only. No prose, no markdown.
- Follow the output schema exactly and include required fields.
- **Keywords must only be in Hindi and in Devanagari**.
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
1) **Normalize** question into **Hindi (Devanagari)** for keyword extraction. Keep original language/script in output. Question can include misspellings, grammar errors, emojis, whatsapp lingos, slangs, sms language and unexpected keywords (normalize them and find most similar hindi keywords)
2) If _greeting_: output workflow=greeting_message_v1 with language, script, is_followup=false. Stop.
3) If the question asks for _metadata_ relations (see `metadata_question_v1`), include `asked_info` array (allowed: granth, anuyog, author, link) [always add granth] and return. No need to proceed further.
4) Extract explicit **filters** (granth, anuyog, contributor). If none, inherit last filters from history. If user removes/changes, clear filters {}. **Filters must be in english always.**
5) Determine **is_followup** (relates to history). Determine action intent.
6) If `is_followup=true`:
   - workflow=followup_question_v1
   - followup_keywords: keywords extracted from matched history sets (questions/answers) 
   - expand_chunk_ids: up to 5 from matched sets (few top chunks from each set basis score) (up to 10, if user asks for more detail in question) 
   - If PureQuestion or Mixed: extract question(s) part (not action) and classify into - basic, distinct or nested followup question. Add `keywords` for basic, `queries` for distnict or `main_query + sub_queries` for nested.
   - If PureRequest: skip
7) If `is_followup=false`: select best workflow and fill keywords/queries/main_query accordingly.
8) **Jain Keyword Classification**: For each extracted keyword, classify it into exactly one of:
   - `jain_keywords[]` — Jain-tradition terms: Sanskrit/Prakrit/Hindi religious or philosophical vocabulary (tattvas, karma types, shastra names, deity/tirthankara names, Jain concepts such as आत्मा, मोक्ष, द्रव्य, संसार, etc.)
   - `normal_keywords[]` — common/functional words not specific to Jain tradition (e.g. "definition", "how many", "explain")
   **Rule:** `jain_keywords ∪ normal_keywords = keywords[]` — every keyword must appear in exactly one array.
9) **KB entities**: Extract any shastra names or author names explicitly mentioned in the question into `kb_entities`.
10) **KB sub-workflows**: If the question clearly targets a specific Jain knowledge-base operation (see KB Sub-workflow Catalog below), populate `kb_subworkflows[]`. Otherwise set to `null`.

---
## KB Sub-workflow Catalog

### direct_retrieval
Retrieve a specific gatha/verse by number from a named shastra.
Fields: `name`, `shastra` (string), `gatha_number` (integer), `want` (array from: "sanskrit", "prakrit", "hindi", "gujarati", "bhaavarth", "tika")
Example — "Samaysaar ki 6vi gatha ka bhaavarth batao":
`{"name": "direct_retrieval", "shastra": "Samaysaar", "gatha_number": 6, "want": ["bhaavarth"]}`

### search_shastra_for_topics
Search within a specific named shastra for a topic.
Fields: `name`, `shastra` (string), `topic` (string in Hindi/Devanagari)
Example — "Samaysaar mein aatma ke baare mein kya likha hai?":
`{"name": "search_shastra_for_topics", "shastra": "Samaysaar", "topic": "आत्मा"}`

### search_topic_in_shastra
Search across all shastras for a given topic.
Fields: `name`, `topic` (string in Hindi/Devanagari)
Example — "Jain granth moksha ke baare mein kya kehte hain?":
`{"name": "search_topic_in_shastra", "topic": "मोक्ष"}`

If none clearly apply, `kb_subworkflows` must be `null`.

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
  "is_followup": true|false,
  "jain_keywords": ["आत्मा", "द्रव्य"], # Jain-tradition terms subset of keywords[]
  "normal_keywords": ["definition", "meaning"], # non-Jain terms subset of keywords[]; jain + normal = keywords
  "kb_subworkflows": [...] | null, # see KB Sub-workflow Catalog; null if none apply
  "kb_entities": { "shastra_hints": ["Samaysaar"], "author_hints": [] } # names from question; empty arrays if none
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
- `jain_keywords ∪ normal_keywords` must equal `keywords[]` exactly.
