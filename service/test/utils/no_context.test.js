import test from "node:test";
import assert from "node:assert/strict";

import { buildNoContextAnswer } from "../../src/utils/no_context.js";

const EN_FALLBACK =
  "This question cannot be answered at this time due to insufficient scriptural citations or multiple interpretations. To avoid incorrect guidance, we recommend consulting a knowledgeable acharya or scholar or please try rephrasing the question.";
const HI_FALLBACK =
  "अपर्याप्त ग्रंथ उद्धरणों के कारण या अनेक व्याख्याओं के कारण इस समय प्रश्न का उत्तर देना संभव नहीं है। गलत मार्गदर्शन से बचने के लिए, हम किसी ज्ञानी आचार्य या विद्वान से परामर्श करने की सलाह देते हैं अथवा प्रश्न को अलग शब्दों में कहने का प्रयास करें।।";

test("buildNoContextAnswer returns english fallback by default", () => {
  const answer = buildNoContextAnswer({});
  assert.equal(answer, EN_FALLBACK);
});

test("buildNoContextAnswer localizes to hindi for hi/devanagari", () => {
  const answer = buildNoContextAnswer({ language: "hi", script: "devanagari" });
  assert.equal(answer, HI_FALLBACK);
});
