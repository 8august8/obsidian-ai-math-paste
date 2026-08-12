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

export function extractWebFormulaRecords(
  html: string,
  parseHtml?: HtmlParser,
): WebFormulaRecord[] {
  const document = parseClipboardHtml(html, parseHtml);
  if (!document) {
    return [];
  }

  const annotations = Array.from(
    document.querySelectorAll('annotation[encoding="application/x-tex"]'),
  );

  return annotations.map((annotation) => {
    const { latex, container, isDisplay } = formulaParts(annotation);
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

  const annotations = Array.from(
    document.querySelectorAll('annotation[encoding="application/x-tex"]'),
  );
  const replacedTargets = new Set<Element>();
  let restoredCount = 0;
  let restoredInlineCount = 0;
  let restoredDisplayCount = 0;
  let skippedCount = 0;

  for (const annotation of annotations) {
    const { latex, replacementTarget, isDisplay } = formulaParts(annotation);

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
  if (!richResult || richResult.annotationCount === 0 || richResult.restoredCount === 0) {
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
