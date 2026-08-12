import {
  buildProtectedMask,
  normalizeLatexInRange,
  type FormulaNormalizationResult,
} from "./math-normalizer";

interface TextLine {
  start: number;
  contentEnd: number;
  end: number;
  trimmed: string;
  markerStart: number;
}

interface DisplayRange {
  start: number;
  end: number;
}

interface Replacement {
  start: number;
  end: number;
  text: string;
  type: "inline" | "display";
}

interface DelimiterRestoration {
  text: string;
  rangeEnd: number;
  inlineCount: number;
  displayCount: number;
}

function isEscapedAt(text: string, index: number): boolean {
  let slashCount = 0;
  for (let cursor = index - 1; cursor >= 0 && text[cursor] === "\\"; cursor -= 1) {
    slashCount += 1;
  }
  return slashCount % 2 === 1;
}

function collectLines(text: string): TextLine[] {
  const lines: TextLine[] = [];
  let start = 0;

  while (start < text.length) {
    const newlineIndex = text.indexOf("\n", start);
    const end = newlineIndex === -1 ? text.length : newlineIndex + 1;
    let contentEnd = newlineIndex === -1 ? text.length : newlineIndex;
    if (contentEnd > start && text[contentEnd - 1] === "\r") {
      contentEnd -= 1;
    }

    const content = text.slice(start, contentEnd);
    const trimmed = content.trim();
    lines.push({
      start,
      contentEnd,
      end,
      trimmed,
      markerStart: start + Math.max(0, content.indexOf(trimmed)),
    });
    start = end;
  }

  return lines;
}

function hasStrongMathEvidence(content: string): boolean {
  const candidate = content.trim();
  if (
    !candidate ||
    candidate.length > 20_000 ||
    /[A-Za-z]:\\[^\s]/.test(candidate)
  ) {
    return false;
  }

  if (/\\[A-Za-z]+/.test(candidate)) {
    return true;
  }
  if (
    /(?:^|[^A-Za-z0-9])(?:[A-Za-z]{1,3}|\})[_^]\s*(?:\{[^}\r\n]+\}|[A-Za-z0-9+-](?![A-Za-z0-9]))/.test(
      candidate,
    )
  ) {
    return true;
  }
  if (/[A-Za-z0-9})\]]\s*(?:=|<|>|≤|≥|≈|∝|→|←|↔)\s*[A-Za-z0-9({[]/.test(candidate)) {
    return true;
  }
  return /(?:^|\s)[A-Za-z]\w*\s*[+\-*/]\s*[A-Za-z0-9]/.test(candidate);
}

function looksLikeInlineMath(content: string): boolean {
  const candidate = content.trim();
  if (
    !candidate ||
    candidate.length > 240 ||
    /[\r\n`$]/.test(candidate) ||
    /(?:https?:\/\/|www\.)/i.test(candidate) ||
    /[A-Za-z]:\\[^\s]/.test(candidate)
  ) {
    return false;
  }

  if (/\\[A-Za-z]+/.test(candidate)) {
    return true;
  }
  if (/[\u3400-\u9fff\uf900-\ufaff]/.test(candidate)) {
    return false;
  }
  if (
    /(?:^|[^A-Za-z0-9])(?:[A-Za-z]{1,3}|\})[_^]\s*(?:\{[^}\r\n]+\}|[A-Za-z0-9+-](?![A-Za-z0-9]))/.test(
      candidate,
    )
  ) {
    return true;
  }
  if (/^[A-Za-z](?:_[A-Za-z0-9]+)?(?:\s*,\s*[A-Za-z](?:_[A-Za-z0-9]+)?)+$/.test(candidate)) {
    return true;
  }
  return (
    /[A-Za-z0-9})\]]\s*(?:=|<|>|≤|≥|≈|∝|→|←|↔|\+|\*|\/)\s*[A-Za-z0-9({[]/.test(
      candidate,
    ) &&
    !/\s{2,}/.test(candidate)
  );
}

function markRange(mask: Uint8Array, start: number, end: number): void {
  for (let index = start; index < end; index += 1) {
    mask[index] = 1;
  }
}

function markExplicitLatexMath(text: string, mask: Uint8Array): void {
  for (const [opening, closing] of [
    ["\\(", "\\)"],
    ["\\[", "\\]"],
  ] as const) {
    let cursor = 0;
    while (cursor < text.length - 1) {
      const start = text.indexOf(opening, cursor);
      if (start === -1) {
        break;
      }
      if (mask[start] || isEscapedAt(text, start)) {
        cursor = start + 2;
        continue;
      }

      const closeStart = text.indexOf(closing, start + 2);
      if (closeStart === -1) {
        break;
      }
      markRange(mask, start, closeStart + 2);
      cursor = closeStart + 2;
    }
  }
}

function collectDisplayReplacements(
  text: string,
  lines: TextLine[],
  mask: Uint8Array,
  rangeStart: number,
  rangeEnd: number,
): { replacements: Replacement[]; ranges: DisplayRange[] } {
  const replacements: Replacement[] = [];
  const ranges: DisplayRange[] = [];
  let lineIndex = 0;

  while (lineIndex < lines.length) {
    const opening = lines[lineIndex];
    if (
      !opening ||
      opening.trimmed !== "[" ||
      opening.markerStart < rangeStart ||
      opening.markerStart >= rangeEnd ||
      mask[opening.markerStart]
    ) {
      lineIndex += 1;
      continue;
    }

    let closingIndex = lineIndex + 1;
    while (closingIndex < lines.length) {
      const candidate = lines[closingIndex];
      if (!candidate || candidate.markerStart >= rangeEnd || candidate.trimmed === "[") {
        break;
      }
      if (candidate.trimmed === "]" && !mask[candidate.markerStart]) {
        const content = text.slice(opening.end, candidate.start);
        if (hasStrongMathEvidence(content)) {
          replacements.push(
            {
              start: opening.markerStart,
              end: opening.markerStart + 1,
              text: "\\[",
              type: "display",
            },
            {
              start: candidate.markerStart,
              end: candidate.markerStart + 1,
              text: "\\]",
              type: "display",
            },
          );
          ranges.push({ start: opening.markerStart, end: candidate.markerStart + 1 });
          lineIndex = closingIndex + 1;
        }
        break;
      }
      closingIndex += 1;
    }

    if (lineIndex <= closingIndex) {
      lineIndex += 1;
    }
  }

  return { replacements, ranges };
}

function isInsideDisplayRange(index: number, ranges: DisplayRange[]): boolean {
  return ranges.some((range) => index >= range.start && index < range.end);
}

function collectInlineReplacements(
  text: string,
  lines: TextLine[],
  mask: Uint8Array,
  displayRanges: DisplayRange[],
  rangeStart: number,
  rangeEnd: number,
): Replacement[] {
  const replacements: Replacement[] = [];

  for (const line of lines) {
    if (line.contentEnd <= rangeStart || line.start >= rangeEnd) {
      continue;
    }

    const stack: number[] = [];
    const start = Math.max(line.start, rangeStart);
    const end = Math.min(line.contentEnd, rangeEnd);

    for (let index = start; index < end; index += 1) {
      if (mask[index] || isInsideDisplayRange(index, displayRanges)) {
        stack.length = 0;
        continue;
      }

      if (text[index] === "(" && !isEscapedAt(text, index)) {
        stack.push(index);
        continue;
      }

      if (text[index] !== ")" || isEscapedAt(text, index) || stack.length === 0) {
        continue;
      }

      const opening = stack.pop();
      if (opening === undefined || stack.length > 0) {
        continue;
      }

      const content = text.slice(opening + 1, index);
      if (looksLikeInlineMath(content)) {
        replacements.push({
          start: opening,
          end: index + 1,
          text: `\\(${content}\\)`,
          type: "inline",
        });
      }
    }
  }

  return replacements;
}

export function restoreStrippedMathDelimiters(
  text: string,
  rangeStart = 0,
  rangeEnd = text.length,
): DelimiterRestoration {
  const start = Math.max(0, Math.min(rangeStart, text.length));
  const end = Math.max(start, Math.min(rangeEnd, text.length));
  const mask = buildProtectedMask(text);
  markExplicitLatexMath(text, mask);
  const lines = collectLines(text);
  const display = collectDisplayReplacements(text, lines, mask, start, end);
  const inline = collectInlineReplacements(
    text,
    lines,
    mask,
    display.ranges,
    start,
    end,
  );
  const replacements = [...display.replacements, ...inline].sort(
    (left, right) => right.start - left.start,
  );
  let restored = text;
  let endDelta = 0;

  for (const replacement of replacements) {
    restored =
      restored.slice(0, replacement.start) +
      replacement.text +
      restored.slice(replacement.end);
    endDelta += replacement.text.length - (replacement.end - replacement.start);
  }

  return {
    text: restored,
    rangeEnd: end + endDelta,
    inlineCount: inline.length,
    displayCount: display.ranges.length,
  };
}

export function normalizeMathInRange(
  text: string,
  rangeStart = 0,
  rangeEnd = text.length,
): FormulaNormalizationResult {
  const restored = restoreStrippedMathDelimiters(text, rangeStart, rangeEnd);
  const normalized = normalizeLatexInRange(
    restored.text,
    rangeStart,
    restored.rangeEnd,
  );

  return {
    ...normalized,
    recoveredInlineDelimiterCount: restored.inlineCount,
    recoveredDisplayDelimiterCount: restored.displayCount,
  };
}
