# Keyword Extraction + Workflow Selection

You are given the following user question about Jain texts:

Question: <QUESTION_HERE>

Tasks/Workflow:
0. The user question can be a mix of english or hindi or hinglish. Convert it into pure hindi first.
1. Understand weather the question is actually a jainism question or a user-request for some action (understand intent in that case)
2. If its a jainism related question, Select the appropriate workflow id from the workflow catalog by understanding the question type.
3. Decide whether the user question is a **new question** or a **follow‑up** to the previous user question in the session. Mark `is_followup` as true in that case.
4. Extract essential keywords for CatalogueSearch according to the selected workflow (Each workflow has different keyword and response shapes, refer below).
5. Extract any explicit filter intent (granth /anuyog/contributor/content_type/year range) from the user question. If it is a followup question and the intent is to use the same filter, pass the filter irrespective of the query keywords. If the intent is to move on to a new question, clear up the filters value.
6. If it is a follow‑up, include:
- `keywords`: keywords derived from the current question (only if its a new jainism related question and not a user request)
- `followup_keywords`: keywords derived from the previous context.
- `expand_chunk_ids`: list of chunk_ids from the previous answer.

Workflow catalog: <WORKFLOW_CATALOG>

Rules:
1. The keywords should be in hindi with devanagari script irrespective of the user language/script.

Output JSON only (examples of shapes by workflow):

- basic_question_v1
```
{
  "language": "hi",
  "workflow": "basic_question_v1",
  "keywords": ["..."],
  "filters": {
    "granth": "Samaysaar"
  },
  "is_followup": false,
  "followup_keywords": [],
  "expand_chunk_ids": []
}
```

- followup_question_v1:
```
{
  "language": "hi",
  "workflow": "followup_question_v1",
  "keywords": ["..."],
  "filters": {
    "granth": "Samaysaar"
  },
  "is_followup": true,
  "followup_keywords": ["..."],
  "expand_chunk_ids": ["..."]
}
```

- advanced_distinct_questions_v1:
```
{
  "language": "hi",
  "workflow": "advanced_distinct_questions_v1",
  "filters": {
    "granth": "Samaysaar"
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
  "workflow": "advanced_nested_questions_v1",
  "filters": {
    "granth": "Samaysaar"
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

Output JSON format:
```
{
  "language": "<hi|gu|en|...>",
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
  "is_followup": "<true|false>",
  "followup_keywords": ["<optional>"],
  "expand_chunk_ids": ["<optional>"]
}
```
