// Cleanup for scripture prose (bhaavarth / teeka) coming from the KB
// core-service. The source is publisher HTML with colored spans (शंका/प्रश्न
// vs समाधान/उत्तर), BOM/zero-width chars, and `*((...))*` clarification notes.
// We convert it to lightweight Markdown the Step2 LLM (and the UI) can render,
// and lightly re-organize numbered points / Q–A markers onto their own lines.

const ZERO_WIDTH_RE = /[﻿​‌‍]/g;

const HTML_ENTITIES = {
  "&nbsp;": " ",
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&#39;": "'",
};

/**
 * Convert one block of publisher HTML scripture prose to Markdown.
 * Returns "" for empty/non-string input.
 */
export function cleanScriptureText(raw) {
  if (typeof raw !== "string" || raw.length === 0) return "";

  let s = raw.replace(ZERO_WIDTH_RE, "");

  // Block-level tags → line breaks.
  s = s.replace(/<br\s*\/?>/gi, "\n");
  s = s.replace(/<\/p>/gi, "\n\n").replace(/<p\b[^>]*>/gi, "");

  // Inline emphasis tags → Markdown.
  s = s.replace(/<\/?(?:strong|b)\b[^>]*>/gi, "**");
  s = s.replace(/<\/?(?:em|i)\b[^>]*>/gi, "*");

  // Colored spans (red ≈ शंका/प्रश्न, green ≈ समाधान/उत्तर, blue ≈ emphasis) are
  // already wrapped in `**…**` by the publisher source, so just drop the tags
  // and keep the inner text — adding our own bold would double it up.
  s = s.replace(/<[^>]+>/g, "");

  // Decode the handful of HTML entities that appear in the corpus.
  s = s.replace(/&[a-z]+;|&#\d+;/gi, (e) => HTML_ENTITIES[e] ?? e);

  // `*((clarification))*` → `*(clarification)*` (italic parenthetical note).
  s = s.replace(/\*\(\(\s*([\s\S]*?)\s*\)\)\*/g, "*($1)*");

  // Normalize stray emphasis: a run of 3+ asterisks (from source `**` hugging a
  // now-removed colored span, e.g. `**<span…>प्रश्न…</span>**` → `****प्रश्न…`)
  // collapses back to a single bold marker.
  s = s.replace(/\*{3,}/g, "**");

  // Re-organize: put numbered points and Q–A markers on their own lines.
  // A numbered point like " 2. " or " 3-5. " mid-paragraph → new block.
  s = s.replace(/\s+(\d+(?:-\d+)?\.)\s+/g, "\n\n$1 ");
  // Q–A markers (incl. ones we just bolded) start a fresh line.
  s = s.replace(/\s*(\*\*(?:शंका|प्रश्न|समाधान|उत्तर)\b)/g, "\n$1");

  // Whitespace tidy: trim each line, collapse 3+ blank lines, trim ends.
  s = s
    .split("\n")
    .map((line) => line.replace(/[ \t]+/g, " ").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  return s;
}

/**
 * Clean and join a list of localized-string blocks (`[{lang, text}, ...]`)
 * into a single Hindi-preferred Markdown string, separating multiple blocks
 * with a blank line.
 */
export function cleanScriptureBlocks(blocks, pickText) {
  if (!Array.isArray(blocks)) return "";
  return blocks
    .map((b) => cleanScriptureText(pickText(b?.text)))
    .filter(Boolean)
    .join("\n\n");
}
