import assert from "node:assert/strict";
import test from "node:test";
import { resultNotice } from "../src/notices";

void test("reports restored and skipped web formulas", () => {
  const message = resultNotice(
    {
      text: "",
      changed: true,
      inlineCount: 14,
      displayCount: 3,
      unmatchedCount: 0,
      webRestoredCount: 17,
      skippedWebFormulaCount: 1,
    },
    true,
  );

  assert.equal(
    message,
    "Cleaned 17 formulas (14 inline, 3 display; recovered 17 from HTML); skipped 1 formulas without a reliable mapping",
  );
});

void test("reports delimiters restored from metadata-free clipboard text", () => {
  const message = resultNotice(
    {
      text: "",
      changed: true,
      inlineCount: 3,
      displayCount: 1,
      unmatchedCount: 0,
      recoveredInlineDelimiterCount: 3,
      recoveredDisplayDelimiterCount: 1,
    },
    true,
  );

  assert.equal(
    message,
    "Cleaned 4 formulas (3 inline, 1 display); restored 4 stripped delimiters",
  );
});
