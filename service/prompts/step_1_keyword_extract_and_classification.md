# Keyword Extraction + Workflow Selection

You are given a new user question about Jainism. A `Conversation History` is also provided to you for previously asked questions and answers (with their relevant retrieval info called chunk_ids, These chunk_ids are ids for the chunks of texts which were used to generate answers for these questions.)

Each set in conversation history has -
- `id`: "set_1", "set_2", ...
- `question`
- `answer` (text only)
- `chunk_ids` (array of chunk_id strings)
- `chunk_scores` (array of objects: { "chunk_id": "<id>", "score": <integer> })

## User Question
<QUESTION_HERE>

---
## Conversation History (JSON array of sets)

<CONVERSATION_HISTORY_HERE>

---

## Goal
Emit a strict JSON object that matches one of the workflow shapes (examples below) for the above user-question. It should contain organized information extracted on the basis of the user-question intent and essential keywords extracted from the user-question formatted in its relevant schema. Think step by step to classify and extract, but do NOT output any reasoning.

(This JSON will be utilized to pefrom a RAG based retrieval from Jain Texts through an external service and that context will be used for answer generation through a subsequent LLM call later.)

## Workflow Catalog

For selecting the single best workflow id for the user question.

### Available Workflows

#### basic_question_v1
Use for simple definitional/comparative questions.
Examples:
- “Jeev kise kehte hain?”
- "Atma ke gyaan aur darshan guna me kya bhed hai?"
- “Ajiv kya hai?”
- “Karma kya hai?”

#### advanced_distinct_questions_v1
Use when the user asks multiple distinct questions in one request.
Examples:
- “Jeev kya hai aur ajiv kya hai?”
- “Samyak darshan aur samyak gyaan kya hai?”

#### advanced_nested_questions_v1
Use when the user asks nested questions, where one or more questions are around a main question.
Examples:
- “Ashrav tattva ka swaroop kya hai? Kya raag dwesh bhi isi me aate hain?”
- “Bandh kaise hota hai? Kya bandh ki kriya apne upadan se hoti hai?”

#### followup_question_v1
Use when the user asks for more detail or references or expanding some element of previous answer.
Trigger phrases:
- “Aur batao”
- “Detail me”
- “Granth me aur kya aya hai"
- “More explanation”
- "Explain what do you mean by Gyaan guna"

## Tasks (in order)
1. Normalize the user question for keyword extraction:
   - The user question may be:
     - pure English in Latin script
     - pure Hindi in Devanagari
     - Hindi written in Latin script (e.g., "Atma kya hai?")
     - mixed Hinglish in Latin script (e.g., "What is Atma? Detail me explain karo")
   - For ALL of these cases, first translate/normalize into pure Hindi language in Devanagari script, and ONLY then proceed further but save the original question info in the output under the fields -
     - `language`: "hi"
     - `script`: "latin"

2. Extract explicit filter intent from the user-question (granth, anuyog, contributor, content_type, year_from, year_to) (details in schema at the end).
   - If user explicitly does not specify any filter intent in the user question, keep the same filters as the previous turn (default behaviour)
   - If user explicitly shifts to a new topic or removes filters in the user question, clear filters `{}`.
   - e.g when user-question is "समयसार शास्त्र के आधार से उत्तर दें", the following fields should be popluated -

   ```
   "filters": {
    "granth": "Samaysaar", #must be in english always
    "content_type": ["Granth", "Books"] #default
   }
   ```

2. Determine action intent of the user question:
   - Is it a Jainism content question without any further request?
   - Is it a user request/action? (like expanding a previous question, asking about a specific detail of a previous answer etc.)
   - Is it a mixed request? (for ex. user is asking to expand previous question and adding a new question as well)

4. Decide if the question is a follow-up question/follow-up request (Relates to previous questions/answers):
   - Set `is_followup` true


Now, the further steps will be dependent whether is_followup is true or not.

1. If is_followup is `true`:
   - workflow id will be `followup_question_v1`.
   - from the conversation history, match what all questions/answers set are relevant to the current user-question (there can be cases like expansion request of some previous question or specific detail/concept expansion etc.)
   - add the following params in output:
      - `keywords` (optional): extracted from the current user-question (only in the cases where some additional question is being asked, not pure expansion requests like "Explain in Detail")
      - `followup_keywords`: all the matched question and answers will be added with their id (set-id) and an array of keywords extracted from them to answer the current question.
      - `expand_chunk_ids`: chunk_ids attached in the matched questions/answers set which are relevant to the current user-question. (this will help in returning the context of these chunks again for the current user-question as well)
        - Include at most `15` chunk_ids in total, highest score first.
        - So, lets say if the new question matches the most with set_1 and set_3 in history, then the top chunk_ids of set_1 and set_3 will be prioritized

2. If is_followup is `false`:
   - Based on the intent of the question, select the best workflow id from the catalog.
   - Based on the workflow type, extract relevant keywords following the structure shared in the below examples by workflow shapes. For ex, if it is a advanced_distinct_questions_v1 workflow, populate `queries` param with an array of queries, each query having its own keywords array.

## Hard Rules
- Output correctly because every output will be reviewed in detail manually.
- Output JSON only. No prose, no markdown, no trailing commentary.
- All type of question/requests will only return a valid JSON shape with atleast these 5 fields populated:
  - `language`: "hi"
  - `script`: "latin"
  - `workflow`: "basic_question_v1"
  - `filters`: {} (details in next steps)
  - atleast any one of the relevant (workflow-specific) field populated for extracted keywords (`keywords/followup_keywords/queries or main_query etc.`)
- Keywords must be Hindi and in Devanagari, regardless of the user question language or script. All the other fields and their values in the output JSON will be only in English including filters, content_type etc.
- `language` must reflect the user question language, not the prompt language: "hi", or "en".
- `content_type` must be an array of strings: ["Granth"] or ["Books"] or ["Granth", "Books"] (default).
- Do not invent filters that are not explicitly requested.

## Output JSON examples (by workflow shapes)

- basic_question_v1
```
{
  "language": "hi",
  "script": "devanagari",
  "workflow": "basic_question_v1",
  "keywords": ["आत्मा", "वीर्य", "गुण"],
  "filters": {
    "granth": "Samaysaar",
    "content_type": ["Granth", "Books"]
  },
  "is_followup": false,
  "followup_keywords": [],
  "expand_chunk_ids": []
}
```

- advanced_distinct_questions_v1:
```
{
  "language": "hi",
  "script": "latin",
  "workflow": "advanced_distinct_questions_v1",
  "filters": {
    "granth": "Samaysaar",
    "content_type": ["Granth", "Books"]
  },
  "queries": [
    { "id": "q1", "keywords": ["..."] },
    { "id": "q2", "keywords": ["..."] }
  ],
  "is_followup": false,
  "followup_keywords": [],
  "expand_chunk_ids": []
}
```

- advanced_nested_questions_v1:
```
{
  "language": "hi",
  "script": "latin",
  "workflow": "advanced_nested_questions_v1",
  "filters": {
    "granth": "Samaysaar",
    "content_type": ["Granth", "Books"]
  },
  "main_query": { "keywords": ["..."] },
  "sub_queries": [
    { "id": "s1", "keywords": ["..."] }
  ],
  "is_followup": false,
  "followup_keywords": [],
  "expand_chunk_ids": []
}
```
---

- followup_question_v1:
```
{
  "language": "hi",
  "script": "devanagari",
  "workflow": "followup_question_v1",
  "keywords": ["..."],
  "filters": {
    "granth": "Samaysaar",
    "content_type": ["Granth", "Books"]
  },
  "is_followup": true,
  "followup_keywords": #matched previous questions/answers set
  [
    { "id": "<set_1>", "keywords": ["..."] },
    { "id": "<set_3>", "keywords": ["..."] }
  ]
  "expand_chunk_ids": ["..."] #matched previous questions/answers set's chunks_ids, sorted by scores (highest first)
}
```
---
### Output JSON schema
```
{
  "language": "<hi|en|...>",
  "script": "<latin|devanagari|...>"
  "workflow": "<one_workflow_id>",
  "keywords": ["..."],
  "filters": {
    "granth": "<optional>",
    "anuyog": "<optional>",
    "contributor": "<optional>",
    "content_type": ["<optional: array of Granth|Books>"],
    "year_from": "<optional>",
    "year_to": "<optional>"
  },
  "queries": [
    { "id": "<string>", "keywords": ["..."] },
    { "id": "<string>", "keywords": ["..."] }
  ],
  "main_query": { "keywords": ["..."] },
  "sub_queries": [
    { "id": "<string>", "keywords": ["..."] }, ...
  ],
  "is_followup": "<true|false>",
  "followup_keywords": [
    { "id": "<string>", "keywords": ["..."] }, ...
  ],
  "expand_chunk_ids": ["<optional>"]
}
```
