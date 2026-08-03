import assert from "node:assert/strict";
import test from "node:test";
import { readClipboardPayload, type ClipboardLike } from "../src/clipboard";

void test("reads plain text and HTML from a rich clipboard item", async () => {
  const values: Record<string, string> = {
    "text/plain": String.raw`τ\tauτ`,
    "text/html": '<span class="katex"></span>',
  };
  const clipboard: ClipboardLike = {
    read: async () => [
      {
        types: ["text/plain", "text/html"],
        getType: async (type) => ({ text: async () => values[type] ?? "" }),
      },
    ],
    readText: async () => {
      throw new Error("rich clipboard should be preferred");
    },
  };

  assert.deepEqual(await readClipboardPayload(clipboard), {
    plainText: values["text/plain"],
    htmlText: values["text/html"],
  });
});

void test("accepts an HTML-only rich clipboard payload", async () => {
  const clipboard: ClipboardLike = {
    read: async () => [
      {
        types: ["text/html"],
        getType: async () => ({ text: async () => "<math></math>" }),
      },
    ],
    readText: async () => "should not be used",
  };

  assert.deepEqual(await readClipboardPayload(clipboard), {
    plainText: "",
    htmlText: "<math></math>",
  });
});

void test("falls back to readText when rich clipboard access fails", async () => {
  const clipboard: ClipboardLike = {
    read: async () => {
      throw new Error("rich clipboard unavailable");
    },
    readText: async () => String.raw`\(x\)`,
  };

  assert.deepEqual(await readClipboardPayload(clipboard), {
    plainText: String.raw`\(x\)`,
    htmlText: "",
  });
});
