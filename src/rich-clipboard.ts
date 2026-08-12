import { normalizeMathInRange } from "./degraded-math";
import {
  normalizeLatexInRange,
  type FormulaNormalizationResult,
} from "./math-normalizer";

export type HtmlParser = (html: string) => Document;
export type HtmlToMarkdown = (html: string) => string;

export interface WebFormulaRecord {
  latex: string;
  flattenedText: string;
  isDisplay: boolean;
}

export interface SanitizedClipboardHtml {
  html: string;
  annotationCount: number;
  sourceMathCount: number;
  restoredCount: number;
  restoredInlineCount: number;
  restoredDisplayCount: number;
  skippedCount: number;
}

export interface RichClipboardConversion extends SanitizedClipboardHtml {
  originalMarkdown: string;
  restoredMarkdown: string;
}

export interface ClipboardNormalizationOptions {
  convertHtmlToMarkdown: HtmlToMarkdown;
  parseHtml?: HtmlParser;
}

interface FormulaParts {
  latex: string;
  container: Element | null;
  replacementTarget: Element | null;
  isDisplay: boolean;
}

const TEX_ANNOTATION_SELECTOR = 'annotation[encoding="application/x-tex"]';
const SOURCE_MATH_SELECTOR = '[role="math"][data-math-source]';

function parseClipboardHtml(html: string, parseHtml?: HtmlParser): Document | null {
  if (!html) {
    return null;
  }

  try {
    if (parseHtml) {
      return parseHtml(html);
    }
    return new DOMParser().parseFromString(html, "text/html");
  } catch {
    return null;
  }
}

function formulaParts(annotation: Element): FormulaParts {
  const katex = annotation.closest(".katex");
  const mathJax = annotation.closest("mjx-container");
  const math = annotation.closest("math");
  const displayContainer = annotation.closest(".katex-display");
  const container = katex ?? mathJax ?? math;
  const isDisplay = Boolean(
    displayContainer ??
      (math?.getAttribute("display") === "block" ? math : null) ??
      (mathJax?.getAttribute("display") === "true" ? mathJax : null),
  );

  return {
    latex: annotation.textContent ?? "",
    container,
    replacementTarget: displayContainer ?? container,
    isDisplay,
  };
}

function normalizeMetadata(text: string): string {
  return text.replace(/\r\n?/g, "\n").trim();
}

function sourceMathParts(element: Element): FormulaParts {
  const source = element.getAttribute("data-math-source") ?? "";
  const ariaLabel = element.getAttribute("aria-label");
  const latex = normalizeMetadata(source);
  const metadataAgrees =
    ariaLabel === null || normalizeMetadata(ariaLabel) === latex;

  return {
    latex: latex && metadataAgrees ? latex : "",
    container: element,
    replacementTarget: element,
    isDisplay: element.querySelector(".katex-display") !== null,
  };
}

function collectFormulaEntries(document: Document): {
  annotations: Element[];
  sourceMathElements: Element[];
  entries: FormulaParts[];
} {
  const annotations = Array.from(document.querySelectorAll(TEX_ANNOTATION_SELECTOR));
  const annotationEntries = annotations.map(formulaParts);
  const sourceMathElements = Array.from(document.querySelectorAll(SOURCE_MATH_SELECTOR));
  const sourceEntries = sourceMathElements
    .filter((element) => element.querySelector(TEX_ANNOTATION_SELECTOR) === null)
    .map(sourceMathParts);

  return {
    annotations,
    sourceMathElements,
    entries: [...annotationEntries, ...sourceEntries],
  };
}

export function extractWebFormulaRecords(
  html: string,
  parseHtml?: HtmlParser,
): WebFormulaRecord[] {
  const document = parseClipboardHtml(html, parseHtml);
  if (!document) {
    return [];
  }

  const { entries } = collectFormulaEntries(document);

  return entries.map(({ latex, container, isDisplay }) => {
    return {
      latex,
      flattenedText: container?.textContent ?? "",
      isDisplay,
    };
  });
}

export function sanitizeClipboardHtml(
  html: string,
  parseHtml?: HtmlParser,
): SanitizedClipboardHtml | null {
  const document = parseClipboardHtml(html, parseHtml);
  if (!document?.body) {
    return null;
  }

  const { annotations, sourceMathElements, entries } = collectFormulaEntries(document);
  const replacedTargets = new Set<Element>();
  let restoredCount = 0;
  let restoredInlineCount = 0;
  let restoredDisplayCount = 0;
  let skippedCount = 0;

  for (const { latex, replacementTarget, isDisplay } of entries) {
    if (!latex || !replacementTarget || replacedTargets.has(replacementTarget)) {
      skippedCount += 1;
      continue;
    }

    const replacement = isDisplay ? `\\[${latex}\\]` : `\\(${latex}\\)`;
    replacementTarget.replaceWith(document.createTextNode(replacement));
    replacedTargets.add(replacementTarget);
    restoredCount += 1;

    if (isDisplay) {
      restoredDisplayCount += 1;
    } else {
      restoredInlineCount += 1;
    }
  }

  return {
    html: document.body.innerHTML,
    annotationCount: annotations.length,
    sourceMathCount: sourceMathElements.length,
    restoredCount,
    restoredInlineCount,
    restoredDisplayCount,
    skippedCount,
  };
}

export function convertRichClipboardHtml(
  html: string,
  convertHtmlToMarkdown: HtmlToMarkdown,
  parseHtml?: HtmlParser,
): RichClipboardConversion | null {
  if (!html) {
    return null;
  }

  const richResult = sanitizeClipboardHtml(html, parseHtml);
  if (!richResult || richResult.restoredCount === 0) {
    return null;
  }

  try {
    return {
      ...richResult,
      originalMarkdown: convertHtmlToMarkdown(html),
      restoredMarkdown: convertHtmlToMarkdown(richResult.html),
    };
  } catch {
    return null;
  }
}

function addWebStats(
  result: FormulaNormalizationResult,
  richResult: RichClipboardConversion | null,
): FormulaNormalizationResult {
  return {
    ...result,
    webRestoredCount: richResult?.restoredCount ?? 0,
    skippedWebFormulaCount: richResult?.skippedCount ?? 0,
  };
}

export function normalizeClipboardText(
  plainText: string,
  htmlText: string,
  options: ClipboardNormalizationOptions,
): FormulaNormalizationResult {
  const richResult = convertRichClipboardHtml(
    htmlText,
    options.convertHtmlToMarkdown,
    options.parseHtml,
  );

  if (richResult) {
    return addWebStats(normalizeLatexInRange(richResult.restoredMarkdown), richResult);
  }

  return addWebStats(normalizeMathInRange(plainText), null);
}

export function sameTextIgnoringLineEndings(left: string, right: string): boolean {
  const normalize = (text: string): string => text.replace(/\r\n?/g, "\n");
  return normalize(left) === normalize(right);
}
