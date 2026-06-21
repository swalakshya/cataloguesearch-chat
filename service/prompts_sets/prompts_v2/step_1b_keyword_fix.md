# Keyword Fix (Step1b)

You are a RAG keyword fixer with jainism knowledge. Fix the keywords in the following json which were used for rag retrieval from Jain Shastras but returned no response. Fix the keywords, fix spellings, use alternate verbs, but don't use alternate nouns (only change spelling if incorrect).

## User Question
<QUESTION_HERE>

## Step1 JSON
<STEP1_JSON_HERE>

## Missed Jain Keywords with Dictionary Suggestions

The following jain keywords were not found in the Jain term dictionary. The dictionary suggests these canonical alternatives (token → suggestion (similarity_score)):

<MISSED_JAIN_KEYWORDS_WITH_SUGGESTIONS>

For each missed keyword:
- If a suggestion is clearly a valid synonym or canonical form of what the user meant, replace the missed token in `keywords[]` **and** `jain_keywords[]` with that suggestion.
- If no suggestion fits, keep the token in `keywords[]` for fallback search but remove it from `jain_keywords[]`.

## Output
Return ONLY a JSON object that matches the same schema as Step1.
