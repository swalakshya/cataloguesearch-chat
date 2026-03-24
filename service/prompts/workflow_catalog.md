# Workflow Catalog (CatalogueSearch)

Use this catalog to select a workflow for the user question.
Return only one workflow id.

## Available Workflows

### basic_question_v1
Use for simple definitional/compartive questions.
Examples:
- “Jeev kise kehte hain?”
- "Atma ke gyaan aur darshan guna me kya bhed hai?"
- “Ajiv kya hai?”
- “Karma kya hai?”

### followup_question_v1
Use when the user asks for more detail or references.
Trigger phrases:
- “Aur batao”
- “Detail me”
- “Granth me aur kya aya hai"
- “More explanation”

### advanced_distinct_questions_v1
Use when the user asks multiple distinct questions in one request.
Examples:
- “Jeev kya hai aur ajiv kya hai?”
- “Samyak darshan aur samyak gyaan kya hai?”

### advanced_nested_questions_v1
Use when the user asks nested questions.
Examples:
- “Jeev aur Ajiv ka antar kya hai? Ajiv ke bhed batayein”
- “Bandh kaise hota hai? Kya bandh ki kriya apne upadan se hoti hai?”
