import type { FormulaNormalizationResult } from "./math-normalizer";

export function resultNotice(result: FormulaNormalizationResult, pasted: boolean): string {
  const total = result.inlineCount + result.displayCount;
  const webRestoredCount = result.webRestoredCount ?? 0;
  const skippedWebFormulaCount = result.skippedWebFormulaCount ?? 0;
  let message: string;

  if (total > 0) {
    const webDetail = webRestoredCount > 0 ? `; recovered ${webRestoredCount} from HTML` : "";
    message = `Cleaned ${total} formulas (${result.inlineCount} inline, ${result.displayCount} display${webDetail})`;
  } else {
    message = pasted
      ? "Pasted; no formulas needed cleaning"
      : "No formulas needed cleaning";
  }

  if (result.unmatchedCount > 0) {
    message += `; skipped ${result.unmatchedCount} unmatched delimiters`;
  }
  if (skippedWebFormulaCount > 0) {
    message += `; skipped ${skippedWebFormulaCount} formulas without a reliable mapping`;
  }

  return message;
}
