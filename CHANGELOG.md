# Changelog

## 0.3.0

- Recover canonical LaTeX from ChatGPT's `role="math"` and `data-math-source` clipboard HTML.
- Detect inline versus display mode from the associated KaTeX structure.
- Prefer existing MathML TeX annotations when both exact metadata formats are present.
- Reject conflicting `data-math-source` and `aria-label` values instead of guessing.

## 0.2.0

- Recover high-confidence display formulas when current ChatGPT copy-button output strips `\\[...\\]` to standalone `[...]` lines.
- Recover high-confidence inline formulas when `\\(...\\)` is flattened to plain parentheses.
- Keep ambiguous parentheses, prose brackets, code, and existing math unchanged.
- Report how many stripped delimiters were restored.

## 0.1.0

- Paste rich web clipboard content as clean Obsidian math.
- Recover LaTeX from MathML `application/x-tex` annotations.
- Remove duplicated visual, MathML, and LaTeX formula layers when reliable HTML evidence exists.
- Convert `\(...\)` and `\[...\]` to Obsidian-compatible math delimiters.
- Repair a selection or paste at the cursor with one command.
