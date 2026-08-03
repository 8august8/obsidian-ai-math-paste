export interface FormulaNormalizationResult {
  text: string;
  inlineCount: number;
  displayCount: number;
  unmatchedCount: number;
  changed: boolean;
  webRestoredCount?: number;
  skippedWebFormulaCount?: number;
}

type FormulaType = "inline" | "display";

interface FormulaPair {
  type: FormulaType;
  start: number;
  contentStart: number;
  closeStart: number;
  end: number;
}

interface PairCollection {
  pairs: FormulaPair[];
  unmatched: number;
}

function isEscapedAt(text: string, index: number): boolean {
  let slashCount = 0;

  for (let cursor = index - 1; cursor >= 0 && text[cursor] === "\\"; cursor -= 1) {
    slashCount += 1;
  }

  return slashCount % 2 === 1;
}

function markRange(mask: Uint8Array, start: number, end: number): void {
  for (let index = start; index < end; index += 1) {
    mask[index] = 1;
  }
}

function forEachLine(
  text: string,
  callback: (start: number, contentEnd: number, end: number) => void,
): void {
  let start = 0;

  while (start < text.length) {
    const newlineIndex = text.indexOf("\n", start);
    const end = newlineIndex === -1 ? text.length : newlineIndex + 1;
    let contentEnd = newlineIndex === -1 ? text.length : newlineIndex;

    if (contentEnd > start && text[contentEnd - 1] === "\r") {
      contentEnd -= 1;
    }

    callback(start, contentEnd, end);
    start = end;
  }
}

function stripMarkdownContainer(line: string): string {
  return line.replace(
    /^(?:[ \t]*>[ \t]?)*[ \t]*(?:(?:[-+*]|\d+[.)])[ \t]+)?/,
    "",
  );
}

function markFencedCode(text: string, mask: Uint8Array): void {
  let fence: { character: string; length: number } | null = null;

  forEachLine(text, (start, contentEnd, end) => {
    const line = text.slice(start, contentEnd);
    const candidate = stripMarkdownContainer(line);

    if (fence) {
      markRange(mask, start, end);
      const closing = candidate.match(/^(`+|~+)[ \t]*$/);
      const closingFence = closing?.[1];

      if (
        closingFence &&
        closingFence[0] === fence.character &&
        closingFence.length >= fence.length
      ) {
        fence = null;
      }

      return;
    }

    const opening = candidate.match(/^(`{3,}|~{3,})/);
    const openingFence = opening?.[1];
    if (!openingFence) {
      return;
    }

    fence = {
      character: openingFence[0] ?? "",
      length: openingFence.length,
    };
    markRange(mask, start, end);
  });
}

function countRun(
  text: string,
  start: number,
  character: string,
  mask: Uint8Array,
): number {
  let end = start;

  while (end < text.length && text[end] === character && !mask[end]) {
    end += 1;
  }

  return end - start;
}

function markInlineCode(text: string, mask: Uint8Array): void {
  let index = 0;

  while (index < text.length) {
    if (mask[index] || text[index] !== "`") {
      index += 1;
      continue;
    }

    const openingLength = countRun(text, index, "`", mask);
    let cursor = index + openingLength;
    let closingEnd = -1;

    while (cursor < text.length) {
      if (mask[cursor] || text[cursor] !== "`") {
        cursor += 1;
        continue;
      }

      const closingLength = countRun(text, cursor, "`", mask);
      if (closingLength === openingLength) {
        closingEnd = cursor + closingLength;
        break;
      }

      cursor += closingLength;
    }

    if (closingEnd === -1) {
      index += openingLength;
      continue;
    }

    markRange(mask, index, closingEnd);
    index = closingEnd;
  }
}

function isAvailable(
  text: string,
  mask: Uint8Array,
  index: number,
  length: number,
): boolean {
  if (index < 0 || index + length > text.length || isEscapedAt(text, index)) {
    return false;
  }

  for (let offset = 0; offset < length; offset += 1) {
    if (mask[index + offset]) {
      return false;
    }
  }

  return true;
}

function findClosingDollar(
  text: string,
  mask: Uint8Array,
  start: number,
  delimiterLength: number,
): number {
  for (let index = start; index < text.length; index += 1) {
    if (delimiterLength === 1 && (text[index] === "\n" || text[index] === "\r")) {
      return -1;
    }

    if (text[index] !== "$" || !isAvailable(text, mask, index, delimiterLength)) {
      continue;
    }

    if (delimiterLength === 2 && text[index + 1] === "$") {
      return index;
    }

    if (
      delimiterLength === 1 &&
      text[index - 1] !== "$" &&
      text[index + 1] !== "$"
    ) {
      return index;
    }
  }

  return -1;
}

function markExistingDollarMath(text: string, mask: Uint8Array): void {
  let index = 0;

  while (index < text.length) {
    if (mask[index] || text[index] !== "$" || isEscapedAt(text, index)) {
      index += 1;
      continue;
    }

    const delimiterLength = text[index + 1] === "$" ? 2 : 1;

    if (
      delimiterLength === 1 &&
      (text[index - 1] === "$" || text[index + 1] === "$")
    ) {
      index += 1;
      continue;
    }

    const closing = findClosingDollar(
      text,
      mask,
      index + delimiterLength,
      delimiterLength,
    );

    if (closing === -1) {
      index += delimiterLength;
      continue;
    }

    const end = closing + delimiterLength;
    markRange(mask, index, end);
    index = end;
  }
}

function buildProtectedMask(text: string): Uint8Array {
  const mask = new Uint8Array(text.length);
  markFencedCode(text, mask);
  markInlineCode(text, mask);
  markExistingDollarMath(text, mask);
  return mask;
}

function isTargetToken(
  text: string,
  mask: Uint8Array,
  index: number,
  marker: string,
): boolean {
  return (
    text[index] === "\\" &&
    text[index + 1] === marker &&
    isAvailable(text, mask, index, 2)
  );
}

function collectPairs(
  text: string,
  mask: Uint8Array,
  start: number,
  end: number,
  type: FormulaType,
  openingMarker: string,
  closingMarker: string,
): PairCollection {
  const pairs: FormulaPair[] = [];
  let opening: number | null = null;
  let unmatched = 0;
  let index = start;

  while (index < end - 1) {
    if (isTargetToken(text, mask, index, openingMarker)) {
      if (opening === null) {
        opening = index;
      }
      index += 2;
      continue;
    }

    if (isTargetToken(text, mask, index, closingMarker)) {
      if (opening === null) {
        unmatched += 1;
      } else {
        pairs.push({
          type,
          start: opening,
          contentStart: opening + 2,
          closeStart: index,
          end: index + 2,
        });
        opening = null;
      }
      index += 2;
      continue;
    }

    index += 1;
  }

  if (opening !== null) {
    unmatched += 1;
  }

  return { pairs, unmatched };
}

function lineStartAt(text: string, index: number): number {
  return text.lastIndexOf("\n", Math.max(0, index - 1)) + 1;
}

function lineEndAt(text: string, index: number): number {
  const newlineIndex = text.indexOf("\n", index);
  let end = newlineIndex === -1 ? text.length : newlineIndex;

  if (end > 0 && text[end - 1] === "\r") {
    end -= 1;
  }

  return end;
}

function hasUnescapedPipe(line: string): boolean {
  for (let index = 0; index < line.length; index += 1) {
    if (line[index] === "|" && !isEscapedAt(line, index)) {
      return true;
    }
  }

  return false;
}

function splitUnescapedPipes(line: string): string[] {
  const cells: string[] = [];
  let start = 0;

  for (let index = 0; index < line.length; index += 1) {
    if (line[index] === "|" && !isEscapedAt(line, index)) {
      cells.push(line.slice(start, index));
      start = index + 1;
    }
  }

  cells.push(line.slice(start));
  return cells;
}

function isTableSeparator(line: string): boolean {
  const trimmed = stripMarkdownContainer(line).trim();
  const cells = splitUnescapedPipes(trimmed).filter((cell, index, all) => {
    if ((index === 0 || index === all.length - 1) && cell.trim() === "") {
      return false;
    }
    return true;
  });

  return cells.length >= 2 && cells.every((cell) => /^:?-{3,}:?$/.test(cell.trim()));
}

interface MarkdownLine {
  start: number;
  end: number;
  text: string;
}

function previousLine(text: string, start: number): MarkdownLine | null {
  if (start <= 0) {
    return null;
  }

  let end = start - 1;
  if (end > 0 && text[end - 1] === "\r") {
    end -= 1;
  }

  const lineStart = text.lastIndexOf("\n", Math.max(0, end - 1)) + 1;
  return { start: lineStart, end, text: text.slice(lineStart, end) };
}

function nextLine(text: string, end: number): MarkdownLine | null {
  const newlineIndex = text.indexOf("\n", end);
  if (newlineIndex === -1 || newlineIndex + 1 >= text.length) {
    return null;
  }

  const start = newlineIndex + 1;
  const lineEnd = lineEndAt(text, start);
  return { start, end: lineEnd, text: text.slice(start, lineEnd) };
}

function isMarkdownTableLine(text: string, lineStart: number, lineEnd: number): boolean {
  const line = text.slice(lineStart, lineEnd);
  if (!hasUnescapedPipe(line)) {
    return false;
  }

  const trimmed = stripMarkdownContainer(line).trim();
  if (trimmed.startsWith("|") || trimmed.endsWith("|") || isTableSeparator(line)) {
    return true;
  }

  let cursor = lineStart;
  for (let distance = 0; distance < 12; distance += 1) {
    const previous = previousLine(text, cursor);
    if (!previous || !hasUnescapedPipe(previous.text) || previous.text.trim() === "") {
      break;
    }
    if (isTableSeparator(previous.text)) {
      return true;
    }
    cursor = previous.start;
  }

  cursor = lineEnd;
  for (let distance = 0; distance < 2; distance += 1) {
    const next = nextLine(text, cursor);
    if (!next || !hasUnescapedPipe(next.text) || next.text.trim() === "") {
      break;
    }
    if (isTableSeparator(next.text)) {
      return true;
    }
    cursor = next.end;
  }

  return false;
}

function getContainerPrefix(lineBeforeFormula: string): {
  structuralPrefix: string;
  continuationPrefix: string;
} {
  const match = lineBeforeFormula.match(
    /^((?:[ \t]*>[ \t]?)*[ \t]*)(?:((?:[-+*]|\d+[.)])[ \t]+))?/,
  );
  const basePrefix = match?.[1] ?? "";
  const listMarker = match?.[2] ?? "";
  const structuralPrefix = match?.[0] ?? "";
  const continuationPrefix = listMarker
    ? basePrefix + " ".repeat(listMarker.length)
    : basePrefix;

  return { structuralPrefix, continuationPrefix };
}

function renderDisplayPair(text: string, pair: FormulaPair, newline: string): string {
  const content = text.slice(pair.contentStart, pair.closeStart);
  const lineStart = lineStartAt(text, pair.start);
  const lineEnd = lineEndAt(text, pair.end);

  if (isMarkdownTableLine(text, lineStart, lineEnd) || /\r|\n/.test(content)) {
    return `$$${content}$$`;
  }

  const lineBefore = text.slice(lineStart, pair.start);
  const lineAfter = text.slice(pair.end, lineEnd);
  const { structuralPrefix, continuationPrefix } = getContainerPrefix(lineBefore);
  const bodyBefore = lineBefore.slice(structuralPrefix.length);
  let replacement = "";

  if (bodyBefore.trim() !== "") {
    replacement += newline + continuationPrefix;
  }

  replacement += `$$${newline}${continuationPrefix}${content}`;
  replacement += `${newline}${continuationPrefix}$$`;

  if (lineAfter.trim() !== "") {
    replacement += newline + continuationPrefix;
  }

  return replacement;
}

export function normalizeLatexInRange(
  text: string,
  rangeStart = 0,
  rangeEnd = text.length,
): FormulaNormalizationResult {
  const start = Math.max(0, Math.min(rangeStart, text.length));
  const end = Math.max(start, Math.min(rangeEnd, text.length));
  const mask = buildProtectedMask(text);
  const inline = collectPairs(text, mask, start, end, "inline", "(", ")");
  const display = collectPairs(text, mask, start, end, "display", "[", "]");
  const candidates = [...inline.pairs, ...display.pairs].sort(
    (left, right) => left.start - right.start || right.end - left.end,
  );
  const pairs: FormulaPair[] = [];
  let occupiedUntil = start;
  let overlapping = 0;

  for (const pair of candidates) {
    if (pair.start < occupiedUntil) {
      overlapping += 1;
      continue;
    }
    pairs.push(pair);
    occupiedUntil = pair.end;
  }

  const newline = text.includes("\r\n") ? "\r\n" : "\n";
  let cursor = start;
  let output = "";
  let inlineCount = 0;
  let displayCount = 0;

  for (const pair of pairs) {
    output += text.slice(cursor, pair.start);

    if (pair.type === "inline") {
      output += `$${text.slice(pair.contentStart, pair.closeStart)}$`;
      inlineCount += 1;
    } else {
      output += renderDisplayPair(text, pair, newline);
      displayCount += 1;
    }

    cursor = pair.end;
  }

  output += text.slice(cursor, end);

  return {
    text: output,
    inlineCount,
    displayCount,
    unmatchedCount: inline.unmatched + display.unmatched + overlapping,
    changed: output !== text.slice(start, end),
  };
}
