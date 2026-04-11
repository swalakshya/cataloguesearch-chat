import { cleanAnswerText } from "./answer.js";

const FALLBACK_TEXT =
  "This question cannot be answered at this time due to insufficient scriptural citations or multiple interpretations. To avoid incorrect guidance, we recommend consulting a knowledgeable acharya or scholar or please try rephrasing the question.";
const METADATA_FALLBACK_TEXT =
  "This question cannot be answered at this time due to insufficient scriptural citations. To avoid incorrect guidance, we recommend consulting a knowledgeable acharya or scholar.";
const HI_FALLBACK_TEXT =
  "अपर्याप्त ग्रंथ उद्धरणों के कारण या अनेक व्याख्याओं के कारण इस समय प्रश्न का उत्तर देना संभव नहीं है। गलत मार्गदर्शन से बचने के लिए, हम किसी ज्ञानी आचार्य या विद्वान से परामर्श करने की सलाह देते हैं अथवा प्रश्न को अलग शब्दों में कहने का प्रयास करें।।";
const HI_METADATA_FALLBACK_TEXT =
  "अपर्याप्त ग्रंथ उद्धरणों के कारण इस समय प्रश्न का उत्तर देना संभव नहीं है। गलत मार्गदर्शन से बचने के लिए, हम किसी ज्ञानी आचार्य या विद्वान से परामर्श करने की सलाह देते हैं।";

export function buildNoContextAnswer({ language, script } = {}) {
  return cleanAnswerText({ text: FALLBACK_TEXT, language, script });
}

export function getNoContextFallbackText() {
  return FALLBACK_TEXT;
}

export function buildMetadataNoContextAnswer({ language, script } = {}) {
  return cleanAnswerText({ text: METADATA_FALLBACK_TEXT, language, script });
}

export function getMetadataFallbackText() {
  return METADATA_FALLBACK_TEXT;
}

export function getNoContextTextForLocale({ language, script, isMetadata } = {}) {
  const lang = String(language || "").toLowerCase();
  const scr = String(script || "").toLowerCase();
  const useHindi = lang === "hi" && (scr === "latin" || scr === "devanagari");
  if (useHindi) {
    return isMetadata ? HI_METADATA_FALLBACK_TEXT : HI_FALLBACK_TEXT;
  }
  return isMetadata ? METADATA_FALLBACK_TEXT : FALLBACK_TEXT;
}
