import { cleanAnswerText } from "./answer.js";

const FALLBACK_TEXT =
  "This question cannot be answered at this time due to insufficient scriptural citations or multiple interpretations. To avoid incorrect guidance, we recommend consulting a knowledgeable acharya or scholar or please try rephrasing the question.";

export function buildNoContextAnswer({ language, script } = {}) {
  return cleanAnswerText({ text: FALLBACK_TEXT, language, script });
}

export function getNoContextFallbackText() {
  return FALLBACK_TEXT;
}
