import assert from "node:assert/strict";
import test from "node:test";
import {
  convertRichClipboardHtml,
  extractWebFormulaRecords,
  normalizeClipboardText,
  sameTextIgnoringLineEndings,
  sanitizeClipboardHtml,
  type HtmlParser,
  type WebFormulaRecord,
} from "../src/rich-clipboard";

interface Fixture {
  html: string;
  parseHtml: HtmlParser;
}

function escapeHtml(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function fakeClipboardFixture(formulas: WebFormulaRecord[], trailingText = ""): Fixture {
  const formulaHtml = formulas.map(
    ({ flattenedText }, index) =>
      `<span data-formula="${index}">${escapeHtml(flattenedText)}</span>`,
  );
  const html = `<p>${formulaHtml.join("\n")}${escapeHtml(trailingText)}</p>`;

  return {
    html,
    parseHtml: () => {
      const body = { innerHTML: html };
      const annotations = formulas.map(({ latex, flattenedText, isDisplay }, index) => {
        const originalHtml = formulaHtml[index] ?? "";
        const replacementTarget = {
          textContent: flattenedText,
          replaceWith: (node: { textContent?: string | null }) => {
            // eslint-disable-next-line no-unsanitized/property -- controlled test fixture
            body.innerHTML = body.innerHTML.replace(
              originalHtml,
              escapeHtml(node.textContent ?? ""),
            );
          },
        };
        const math = {
          getAttribute: (name: string) =>
            name === "display" && isDisplay ? "block" : null,
        };

        return {
          textContent: latex,
          closest: (selector: string) => {
            if (selector === ".katex") {
              return replacementTarget;
            }
            if (selector === ".katex-display") {
              return isDisplay ? replacementTarget : null;
            }
            if (selector === "math") {
              return math;
            }
            return null;
          },
        };
      });

      return {
        body,
        createTextNode: (textContent: string) => ({ textContent }),
        querySelectorAll: (selector: string) => {
          assert.equal(selector, 'annotation[encoding="application/x-tex"]');
          return annotations;
        },
      } as unknown as Document;
    },
  };
}

function simpleHtmlToMarkdown(html: string): string {
  return html
    .replace(/<\/?p>/g, "")
    .replace(/<span[^>]*>/g, "")
    .replace(/<\/span>/g, "")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&amp;", "&");
}

void test("extracts LaTeX and display mode from clipboard HTML", () => {
  const formulas: WebFormulaRecord[] = [
    { latex: String.raw`\tau`, flattenedText: String.raw`τ\tauτ`, isDisplay: false },
    { latex: "B", flattenedText: "BBB", isDisplay: true },
  ];
  const fixture = fakeClipboardFixture(formulas);

  assert.deepEqual(extractWebFormulaRecords(fixture.html, fixture.parseHtml), formulas);
});

void test("replaces formula DOM nodes with their annotations", () => {
  const fixture = fakeClipboardFixture([
    { latex: String.raw`\tau`, flattenedText: String.raw`τ\tauτ`, isDisplay: false },
    { latex: "B", flattenedText: "BBB", isDisplay: true },
  ]);
  const result = sanitizeClipboardHtml(fixture.html, fixture.parseHtml);

  assert.equal(result?.restoredCount, 2);
  assert.equal(result?.restoredInlineCount, 1);
  assert.equal(result?.restoredDisplayCount, 1);
  assert.equal(result?.skippedCount, 0);
  assert.equal(result?.html, String.raw`<p>\(\tau\)
\[B\]</p>`);
});

void test("restores tripled web formulas before converting HTML to Markdown", () => {
  const formulas: WebFormulaRecord[] = [
    { latex: String.raw`z_{0,i}`, flattenedText: "z0,iz_{0,i}z0,i​", isDisplay: false },
    { latex: "B", flattenedText: "BBB", isDisplay: false },
    { latex: String.raw`\tau`, flattenedText: String.raw`τ\tauτ`, isDisplay: false },
  ];
  const fixture = fakeClipboardFixture(formulas);
  const result = normalizeClipboardText("fallback should not be used", fixture.html, {
    convertHtmlToMarkdown: simpleHtmlToMarkdown,
    parseHtml: fixture.parseHtml,
  });

  assert.equal(result.webRestoredCount, 3);
  assert.equal(result.skippedWebFormulaCount, 0);
  assert.equal(result.inlineCount, 3);
  assert.equal(result.displayCount, 0);
  assert.equal(result.text.includes("BBB"), false);
  assert.equal(result.text.includes(String.raw`τ\tauτ`), false);
  assert.match(result.text, /\$z_\{0,i\}\$/);
  assert.match(result.text, /\$B\$/);
  assert.match(result.text, /\$\\tau\$/);
});

void test("restores repeated identical formulas by distinct DOM nodes", () => {
  const fixture = fakeClipboardFixture([
    { latex: "B", flattenedText: "BBB", isDisplay: false },
    { latex: "B", flattenedText: "BBB", isDisplay: false },
  ]);
  const result = normalizeClipboardText("BBB and normal text BBB", fixture.html, {
    convertHtmlToMarkdown: simpleHtmlToMarkdown,
    parseHtml: fixture.parseHtml,
  });

  assert.equal(result.text, "$B$\n$B$");
  assert.equal(result.webRestoredCount, 2);
});

void test("does not apply degraded inference when annotation evidence exists", () => {
  const fixture = fakeClipboardFixture(
    [{ latex: "B", flattenedText: "BBB", isDisplay: false }],
    " and keep (file_name)",
  );
  const result = normalizeClipboardText("fallback should not be used", fixture.html, {
    convertHtmlToMarkdown: simpleHtmlToMarkdown,
    parseHtml: fixture.parseHtml,
  });

  assert.equal(result.text, "$B$ and keep (file_name)");
  assert.equal(result.recoveredInlineDelimiterCount, undefined);
});

void test("falls back conservatively when HTML has no annotation evidence", () => {
  const plain = String.raw`Keep BBB, repair \(x\).`;
  const result = normalizeClipboardText(plain, "<p>no math</p>", {
    convertHtmlToMarkdown: simpleHtmlToMarkdown,
    parseHtml: () =>
      ({
        body: { innerHTML: "<p>no math</p>" },
        createTextNode: (textContent: string) => ({ textContent }),
        querySelectorAll: () => [],
      }) as unknown as Document,
  });

  assert.equal(result.text, "Keep BBB, repair $x$.");
  assert.equal(result.webRestoredCount, 0);
});

void test("recovers stripped delimiters when copy-button HTML has no math metadata", () => {
  const plain = String.raw`状态转移为：

[
(c_t,\ a_t,\ c_{t+1})
]

由 (m_\eta) 计算。`;
  const html = String.raw`<p>状态转移为：</p><p>[<br>(c_t,\ a_t,\ c_{t+1})<br>]</p><p>由 (m_\eta) 计算。</p>`;
  const result = normalizeClipboardText(plain, html, {
    convertHtmlToMarkdown: simpleHtmlToMarkdown,
    parseHtml: () =>
      ({
        body: { innerHTML: html },
        createTextNode: (textContent: string) => ({ textContent }),
        querySelectorAll: () => [],
      }) as unknown as Document,
  });

  assert.equal(result.webRestoredCount, 0);
  assert.equal(result.recoveredDisplayDelimiterCount, 1);
  assert.equal(result.recoveredInlineDelimiterCount, 1);
  assert.match(result.text, /\$\$\n\(c_t,\\ a_t,\\ c_\{t\+1\}\)\n\$\$/);
  assert.match(result.text, /由 \$m_\\eta\$ 计算/);
});

void test("returns original and restored Markdown for selection rescue", () => {
  const fixture = fakeClipboardFixture([
    { latex: "B", flattenedText: "BBB", isDisplay: false },
  ]);
  const result = convertRichClipboardHtml(
    fixture.html,
    simpleHtmlToMarkdown,
    fixture.parseHtml,
  );

  assert.equal(result?.originalMarkdown, "BBB");
  assert.equal(result?.restoredMarkdown, String.raw`\(B\)`);
  assert.equal(result?.restoredCount, 1);
});

void test("compares selected and clipboard text by line endings only", () => {
  assert.equal(sameTextIgnoringLineEndings("a\r\nb", "a\nb"), true);
  assert.equal(sameTextIgnoringLineEndings("a b", "a  b"), false);
});
