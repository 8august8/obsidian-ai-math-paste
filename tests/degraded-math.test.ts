import assert from "node:assert/strict";
import test from "node:test";
import {
  normalizeMathInRange,
  restoreStrippedMathDelimiters,
} from "../src/degraded-math";

void test("restores current ChatGPT copy-button display and inline math", () => {
  const input = String.raw`一条失败轨迹里同时混着五种信息：

[
(c_t,\ a_t,\ c_{t+1},\ \text{outcome},\ \text{failure cause})
]

其中：

* (c_t) 往往是真实而有价值的状态覆盖；
* (c_t,a_t\to c_{t+1}) 是真实动力学信息；
* (a_t) 可能不应该被模仿；
* outcome 是有价值的负反馈。`;

  const result = normalizeMathInRange(input);

  assert.equal(result.displayCount, 1);
  assert.equal(result.inlineCount, 3);
  assert.equal(result.recoveredDisplayDelimiterCount, 1);
  assert.equal(result.recoveredInlineDelimiterCount, 3);
  assert.match(result.text, /\$\$\n\(c_t,\\ a_t,.*?\n\$\$/s);
  assert.match(result.text, /\* \$c_t\$ 往往/);
  assert.match(result.text, /\* \$c_t,a_t\\to c_\{t\+1\}\$ 是真实/);
  assert.match(result.text, /\* \$a_t\$ 可能/);
});

void test("restores nested and command-heavy inline formulas", () => {
  const input = String.raw`使用 (\mathcal V_\eta)、(a^{(0)}) 和 ((\tau,t))，保留 (q) 与 (this is prose)。`;
  const result = normalizeMathInRange(input);

  assert.equal(result.inlineCount, 3);
  assert.equal(
    result.text,
    String.raw`使用 $\mathcal V_\eta$、$a^{(0)}$ 和 $(\tau,t)$，保留 (q) 与 (this is prose)。`,
  );
});

void test("does not guess standalone prose brackets or natural parentheses", () => {
  const input = String.raw`说明：

[
This is a bracketed prose note.
]

See (Appendix A), (q), (file_name), (C:\Users\name), and (https://example.com).`;
  const result = normalizeMathInRange(input);

  assert.equal(result.displayCount, 0);
  assert.equal(result.inlineCount, 0);
  assert.equal(result.text, input);
});

void test("protects code, existing dollar math, and explicit LaTeX delimiters", () => {
  const input = [
    "```text",
    "[",
    String.raw`c_t=a_t`,
    "]",
    "```",
    "Keep \\(x_t\\), $y_t$, and code `(z_t)`; restore (a_t).",
  ].join("\n");
  const result = normalizeMathInRange(input);

  assert.equal(result.displayCount, 0);
  assert.equal(result.inlineCount, 2);
  assert.match(result.text, /```text\n\[\nc_t=a_t\n\]\n```/);
  assert.match(result.text, /Keep \$x_t\$, \$y_t\$, and code `\(z_t\)`; restore \$a_t\$\./);
});

void test("preserves full-document code context for a selected range", () => {
  const input = ["```text", "(c_t)", "```", "Outside (a_t)."].join("\n");
  const selectedStart = input.indexOf("(c_t)");
  const selectedEnd = selectedStart + "(c_t)".length;
  const result = normalizeMathInRange(input, selectedStart, selectedEnd);

  assert.equal(result.text, "(c_t)");
  assert.equal(result.inlineCount, 0);
});

void test("reports restoration without normalizing when requested directly", () => {
  const restored = restoreStrippedMathDelimiters("Before (c_t) after");
  assert.equal(restored.text, String.raw`Before \(c_t\) after`);
  assert.equal(restored.inlineCount, 1);
  assert.equal(restored.displayCount, 0);
});
