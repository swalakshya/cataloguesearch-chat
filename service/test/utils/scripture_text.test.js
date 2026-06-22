import { test } from "node:test";
import assert from "node:assert/strict";
import { cleanScriptureText, cleanScriptureBlocks } from "../../src/utils/scripture_text.js";

test("cleanScriptureText: strips BOM / zero-width chars", () => {
  const out = cleanScriptureText("﻿जो स्वयं​ है");
  assert.equal(out, "जो स्वयं है");
});

test("cleanScriptureText: source-bolded colored spans keep single bold (no double-up)", () => {
  // Publisher wraps colored spans in `**…**`; stripping the span must not add
  // another bold layer → no `****` artifact.
  const raw = '**<span style="color:red">शंका – क्यों ?</span>** **<span style="color:darkGreen">समाधान –</span>** उत्तर';
  const out = cleanScriptureText(raw);
  assert.ok(out.includes("**शंका – क्यों ?**"), "red span content stays bold");
  assert.ok(out.includes("**समाधान –**"), "green span content stays bold");
  assert.ok(!/\*{3,}/.test(out), "no 3+ asterisk runs");
  assert.ok(!out.includes("<span"), "no span tags remain");
});

test("cleanScriptureText: bare colored span without source bold → plain text", () => {
  const out = cleanScriptureText('<span style="color:blue">नील</span> रंग');
  assert.equal(out, "नील रंग");
});

test("cleanScriptureText: *((clarification))* → *(clarification)*", () => {
  const out = cleanScriptureText("सिद्ध होने से *((किसी से उत्पन्न न होने से))* अनादि है");
  assert.ok(out.includes("*(किसी से उत्पन्न न होने से)*"));
  assert.ok(!out.includes("(("), "double parens removed");
});

test("cleanScriptureText: strips leftover tags and decodes entities", () => {
  const out = cleanScriptureText("<div>a&nbsp;&amp;&nbsp;b</div>");
  assert.equal(out, "a & b");
});

test("cleanScriptureText: numbered points break onto new lines", () => {
  const out = cleanScriptureText("पहला कथन। 2. दूसरा कथन। 3-5. तीसरा कथन।");
  const lines = out.split("\n").filter(Boolean);
  assert.ok(lines.some((l) => l.startsWith("2.")), "point 2 on its own line");
  assert.ok(lines.some((l) => l.startsWith("3-5.")), "range point on its own line");
});

test("cleanScriptureText: collapses excess blank lines and trims", () => {
  const out = cleanScriptureText("  a\n\n\n\nb  ");
  assert.equal(out, "a\n\nb");
});

test("cleanScriptureText: empty / non-string → empty string", () => {
  assert.equal(cleanScriptureText(""), "");
  assert.equal(cleanScriptureText(null), "");
  assert.equal(cleanScriptureText(undefined), "");
});

test("cleanScriptureBlocks: cleans + joins multiple localized blocks", () => {
  const pick = (t) => (Array.isArray(t) ? t[0]?.text || "" : "");
  const blocks = [
    { text: [{ lang: "hin", text: "﻿पहला" }] },
    { text: [{ lang: "hin", text: "<b>दूसरा</b>" }] },
  ];
  const out = cleanScriptureBlocks(blocks, pick);
  assert.equal(out, "पहला\n\n**दूसरा**");
});
