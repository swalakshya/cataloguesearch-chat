# Keyword Extraction + Workflow Selection

You are given a new user question about Jainism. A `Conversation History` is also provided to you for previously asked questions and answers (with their relevant retrieval info called chunk_ids, These chunk_ids are ids for the chunks of texts which were used to generate answers for these questions.)

## User Question
<QUESTION_HERE>

---
## Goal
Emit a strict JSON object that matches one of the workflow shapes (examples below) for the above user-question. It should contain organized information extracted on the basis of the user-question intent and essential keywords extracted from the user-question formatted in its relevant schema. Think step by step to classify and extract, but do NOT output any reasoning.

(This JSON will be utilized to pefrom a RAG based retrieval from Jain Texts through an external service and that context will be used for answer generation through a subsequent LLM call later.)

## Workflow Catalog

For selecting the single best workflow id for the user question.

### Available Workflows

#### greeting_message_v1
Use for message which is a user greeting or a chat initiator. (can include incorrect spelling/grammar and emojis/unexpected keywords as well)
Examples:
- "Jai Jinendra"
- "Jay Jinendra"
- "Jai Jinndra" or a similar mistake
- "Hi"
- "Hello!"
- "How are You?"
- "Namaskaar"
- "जय जिनेन्द्र"

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
- “Pravachansaar Granth me is vishay par aur kya aya hai"
- “More explanation”
- "Explain what do you mean by Gyaan guna"

#### metadata_question_v1
Use when the user asks for metadata lists or metadata facts related to granths, anuyogs, or authors.
Examples:
- "Acharya kundkund ne konse granth likhe hain?"
- "Samaysaar shastra kisne likha hai?"
- "Charnanuyoga ke kuch granth bataiye"

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

2. If the user question is a greeting (matches greeting_message_v1 above) return the response with the workflow type as `greeting_message_v1` with the language and script params added above. (no need of keyword extraction and moving ahead to the below tasks). If not, move ahead to Step 3.

3. If the question asks for metadata relations (see `metadata_question_v1`), include `asked_info` array (allowed: granth, anuyog, author, link) and return. No need to proceed further.

4. Extract explicit filter intent from the user-question if present (granth, anuyog, contributor) (details in schema at the end)
   - If user explicitly does not specify any filter intent in the user question, keep the same filters as the last question of the  conversation history. (default behaviour)
   - If user explicitly shifts to a new topic or removes filters in the user question, clear filters in response `{}`.
   - e.g when user-question is "समयसार शास्त्र के आधार से उत्तर दें", the following fields should be popluated -

   ```
   "filters": {
    "granth": "Samaysaar", #must be in english always
    "content_type": ["Granth", "Books"] #default
   }
   ```

5. Determine action intent of the user question if present:
   - Is it a Jainism content question without any request? [remember this as ACTION INTENT - `PureQuestion`] For ex. "karan parmatma aur karya parmatma me bhed batao" where these two concepts were mentioned in the previous answer in history then --> PureQuestion
   - Is it a user request/action? (like expanding a previous question, giving summary of previous answer) [remember this as ACTION INTENT - `PureRequest`] For ex. "Explain in detail" --> PureRequest
   - Is it a mixed request? (for ex. user is asking to expand previous question and adding a new question as well) [remember this as ACTION INTENT - `Mixed`] For ex. "explain the concept Karan parmatma mentioned above in detail" then --> Mixed

6. Decide if the question is a follow-up question/follow-up request (Relates to previous questions/answers from conversation history):
   - Set `is_followup` true

Now, the further steps will be dependent on whether is_followup is true or not.

1. If is_followup is `true`:
   - workflow id will be `followup_question_v1`.
   - from the conversation history, match what all questions/answers set are relevant to the current user-question (there can be cases like expansion request of some previous question or specific detail/concept expansion etc.)
   - add the following params in output:
      - `followup_keywords`: all the matched question and answers will be added with their id (set-id) and an array of keywords extracted from them (include previous answers' keywords as well if relevant not just previous questions) to answer the current question.
      - `expand_chunk_ids`: chunk_ids attached in the matched questions/answers set which are relevant to the current user-question. (this will help in returning the context of these chunks again for the current user-question as well)
        - Include at most `10` chunk_ids in total, highest score first.
        - So, lets say if the new question matches the most with set_1 and set_3 in history, then the top chunk_ids of set_1 and set_3 will be prioritized
   - only if the current user-question ACTION INTENT is `PureQuestion` or `Mixed`, extract the relevant jainism based question(s) part of it and categorize it as basic followup question, distinct followup questions or nested followup questions. Extract keywords and populate the following fields on the basis of this categorization:
      - `keywords` (if basic followup question)
      - `queries` (if distinct followup questions, each query in the array will have its own keywords)
      - `main_query` and `sub_queries` (if nested followup questions, main query will have main question keywords and sub_queries array will have each sub query's specific keywords)
   - if the current-question ACTION INTENT was `PureRequest` then no extra fields need to be populated

2. If is_followup is `false`:
   - Based on the intent of the question, select the best workflow id from the catalog.
   - Based on the workflow type, extract relevant keywords following the structure shared in the below examples by workflow shapes. For ex, if it is a advanced_distinct_questions_v1 workflow, populate `queries` param with an array of queries, each query having its own keywords array.

## Hard Rules
- Output correctly because every output will be reviewed in detail manually and sent to other ai agents to review.
- Output JSON only. No prose, no markdown, no trailing commentary.
- All type of question/requests will only return a valid JSON shape with atleast these 5 fields populated:
  - `language`: "hi"
  - `script`: "latin"
  - `workflow`: "basic_question_v1"
  - `filters`: {} (details in next steps)
  - atleast any one of the relevant (workflow-specific) field populated for extracted keywords (`keywords/followup_keywords/queries or main_query etc.`)
- Keywords must be Hindi and in Devanagari, regardless of the user question language or script. Add simple keywords. Don't add multiple keywords for same word. All the other fields and their values in the output JSON will be only in English including filters, content_type etc.
- `language` must reflect the user question language, not the prompt language: "hi", or "en".
- `content_type` must be an array of strings: ["Granth"] or ["Books"] or ["Granth", "Books"] (default).
- Do not invent filters that are not explicitly requested.

## Output JSON examples (by workflow shapes)

### base template example
```
{
  "language": "hi",
  "script": "devanagari",
  "filters": { skip if metadata_question_v1
    "granth": "Samaysaar",
    "content_type": ["Granth", "Books"]
  }
}
```

### specific workflow fields
- basic_question_v1
```
{
  "workflow": "basic_question_v1",
  "keywords": ["आत्मा", "वीर्य", "गुण"],
  "is_followup": false
}
```

- advanced_distinct_questions_v1:
```
{
  "workflow": "advanced_distinct_questions_v1",
  "queries": [
    { "id": "q1", "keywords": ["..."] },
    { "id": "q2", "keywords": ["..."] }
  ],
  "is_followup": false
}
```

- advanced_nested_questions_v1:
```
{
  "workflow": "advanced_nested_questions_v1",
  "main_query": { "keywords": ["..."] },
  "sub_queries": [
    { "id": "s1", "keywords": ["..."] }
  ],
  "is_followup": false
}
```
---

- followup_question_v1:
```
{
  "workflow": "followup_question_v1",
  "keywords": ["..."], # or queries or main_query/sub_queries
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
- metadata_question_v1:
```
{
  "workflow": "metadata_question_v1",
  "asked_info": ["granth", "author", "link"],
  "is_followup": false
}
```
---
### Output JSON schema
```
{
  "language": "<hi|en>",
  "script": "<latin|devanagari>"
  "workflow": "<workflow_id>",
  "keywords": ["..."],
  "filters": { #skip if metadata_question_v1
    "granth": "<optional>",
    "anuyog": "<optional>",
    "contributor": "<optional>",
    "content_type": ["<optional: array of Granth|Books>"]
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
  "expand_chunk_ids": ["<optional>"],
  "asked_info": ["granth", "anuyog", "author", "link"]
}
```

### Metadata Options Response Schema (for asked_info)
`external_get_metadata_options` returns:
```
[
  { "granth": "<string>", "author": "<string|null>", "anuyog": "<string|null>", "url": "<string>" },
  ...
]
```
