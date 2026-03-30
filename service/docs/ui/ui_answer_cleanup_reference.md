# UI Answer Cleanup Reference

This document summarizes the cleanup and formatting behaviors applied in the UI when rendering LLM answer responses.

## Overall Flow
- Raw LLM answer text is cleaned before rendering.
- References sections are separated from the main answer body for display.
- Inline citations are styled and positioned without exposing raw tags or placeholders.

## Reference Section Handling
- The UI removes any trailing reference text after a References heading for the main answer display.
- Recognized headings include: References, संदर्भ, सन्दर्भ, स्रोत.
- References displayed in the References block are cleaned to strip extra trailing punctuation after page numbers.

## Citation Rendering Rules
- Inline citations in the answer are expected in subscript form and are rendered as italic subscripts.
- Citations are right-aligned within the answer line where they appear.
- If a citation is followed by a separator character like a pipe or a full stop, the separator is moved to appear before the citation.
- Any stray closing bracket immediately after a citation tag is removed.

## Bold and Heading Treatment
- Bold text that appears on its own line is treated as a heading.
- Headings that start with two or three hash marks are also treated as headings.
- Heading-style bold text is rendered with a separator line below it.
- Inline bold inside sentences is rendered without any separator.

## Italics Handling
- Curly-quoted and straight-quoted segments are rendered in italics.
- Italics are applied after HTML escaping to avoid rendering artifacts.

## Scroll Behavior or Message Splitting
- The answer display area uses a fixed-height scrollable container.
- This prevents long answers from truncating and keeps the page layout stable.
- Or a message can be splitted as required.

## Known Non-Goals
- The UI should not attempt to reconstruct missing references; it only formats and displays what the service returns.
- No automatic reordering of answer content beyond citation cleanup and heading detection.