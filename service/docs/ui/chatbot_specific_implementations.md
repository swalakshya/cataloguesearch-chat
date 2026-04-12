Project Jinam WhatsApp Chatbot

UI Additions
---

## 1. Chatbot Activation
Trigger
When the user sends:
`Jai Jinendra`,
The chatbot activates.

Welcome Message
Structure:
1. Greeting
2. Short introduction
3. Credit to organizations
4. Feedback contact
5. Invitation to ask questions

Example:
```
Jai Jinendra!
Welcome to Jinam - A Jain Knowledge Chatbot.

This initiative is developed by TATTVAM and Origen Systems to help
seekers learn about Jain philosophy, scriptures, and practices.

You may ask any question related to Jain Dharma.

For feedback or suggestions, please write to us at:
[email need to be created]

We wish you a meaningful journey into Jain wisdom.
```

## 2. First-time User Guide
After welcome message show examples:
You can ask questions like:
• Jeev kya hai?
• What is Ahimsa?
• Paryushan kya hai?
• Karma kaise bandh hota hai?
Users often don’t know what to ask.

## 3. Quick Topic Commands [TBA]
Examples

#karma
#jeev
#moksha
#paryushan

Bot gives overview.
[Some cached responses stored in the UI]

## 4. Long Answer Splitting
If answer exceeds WhatsApp readability:
Break into parts:

- Part 1: Answer (multiple messages)
- Part 2: Summary (Starting with सारांश )
- Part 3: References (Starting with References/संदर्भ etc.)

But avoid very long paragraphs.
WhatsApp readability rule:
Max 7–8 lines per message.
If longer, split into multiple messages.

## 5. Closing Message
After long conversations:
```
Jai Jinendra!
If you have more questions about Jain philosophy, feel free to ask.
```

---
## Info - Granth Mode
[This is implmeneted right now with user mentioning the granth name in b/w the query itself]