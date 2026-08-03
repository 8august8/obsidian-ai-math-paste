import assert from "node:assert/strict";
import test from "node:test";
import { normalizeLatexInRange } from "../src/math-normalizer";

void test("converts the supplied GPT and Codex sample", () => {
  const input = String.raw`## Bad-to-Good Correction Flow

Data with coarse labels:

\[ \mathcal D=\{(o_i,a_i,y_i)\}, \qquad y_i\in\{\text{good},\text{bad}\}. \]

Find a bad action $a^-$ and a good action $a^+$:

\[ (o^-,a^-)\leftrightarrow(o^+,a^+). \]

Train a correction flow:

\[ a_t=(1-t)a^-+ta^+ \]\[ \mathcal L = \left\|v_\theta(a_t,t,o)-(a^+-a^-)\right\|_2^2. \]`;

  const result = normalizeLatexInRange(input);

  assert.equal(result.displayCount, 4);
  assert.equal(result.inlineCount, 0);
  assert.equal(result.unmatchedCount, 0);
  assert.equal(result.text.includes("\\["), false);
  assert.equal(result.text.includes("\\]"), false);
  assert.match(result.text, /bad action \$a\^-\$ and a good action \$a\^\+\$/);
  assert.match(result.text, /\$\$\n a_t=.*?\n\$\$\n\n\$\$\n \\mathcal L/s);
});

void test("converts inline delimiters and preserves existing dollar math", () => {
  const result = normalizeLatexInRange(String.raw`Inline \(x+y\), existing $z$ and $$w$$.`);

  assert.equal(result.text, "Inline $x+y$, existing $z$ and $$w$$.");
  assert.equal(result.inlineCount, 1);
  assert.equal(result.displayCount, 0);
});

void test("skips fenced and inline code", () => {
  const input = [
    "```python",
    String.raw`value = "\[not_math\]"`,
    "```",
    "Keep \\(also_not_math\\) in code: `\\(also_not_math\\)`; convert \\(x\\).",
  ].join("\n");
  const result = normalizeLatexInRange(input);

  assert.equal(result.inlineCount, 2);
  assert.equal(result.displayCount, 0);
  assert.equal(result.text.includes(String.raw`\[not_math\]`), true);
  assert.equal(result.text.includes(String.raw`\(also_not_math\)`), true);
  assert.match(result.text, /convert \$x\$/);
});

void test("keeps table display math on one line", () => {
  const input = String.raw`| Method | Objective |
|---|---|
| BC | \[ \mathcal L=\|x-y\|^2 \] |`;
  const result = normalizeLatexInRange(input);

  assert.equal(
    result.text,
    String.raw`| Method | Objective |
|---|---|
| BC | $$ \mathcal L=\|x-y\|^2 $$ |`,
  );
});

void test("preserves list indentation and blockquote prefixes", () => {
  const input = String.raw`- Loss:
  \[ x+y \]

> \[ z>0 \]`;
  const result = normalizeLatexInRange(input);

  assert.equal(
    result.text,
    ["- Loss:", "  $$", "   x+y ", "  $$", "", "> $$", ">  z>0 ", "> $$"].join("\n"),
  );
});

void test("splits a same-line display formula away from prose", () => {
  const result = normalizeLatexInRange(String.raw`Before \[ x+y \] after`);
  assert.equal(result.text, "Before \n$$\n x+y \n$$\n after");
});

void test("leaves unmatched delimiters unchanged and reports them", () => {
  const result = normalizeLatexInRange(String.raw`Broken \[x, valid \(y\).`);

  assert.equal(result.text, String.raw`Broken \[x, valid $y$.`);
  assert.equal(result.inlineCount, 1);
  assert.equal(result.unmatchedCount, 1);
});

void test("uses full-document context when a selection is inside code", () => {
  const input = ["```text", String.raw`\[do_not_change\]`, "```"].join("\n");
  const start = input.indexOf("\\[");
  const end = input.indexOf("\\]") + 2;
  const result = normalizeLatexInRange(input, start, end);

  assert.equal(result.text, String.raw`\[do_not_change\]`);
  assert.equal(result.displayCount, 0);
});

void test("preserves multiline wrappers while changing only delimiters", () => {
  const input = ["> \\[", "> x+y", "> \\]"].join("\r\n");
  const result = normalizeLatexInRange(input);

  assert.equal(result.text, ["> $$", "> x+y", "> $$"].join("\r\n"));
  assert.equal(result.displayCount, 1);
});
