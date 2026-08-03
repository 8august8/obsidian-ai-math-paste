export interface ClipboardPayload {
  plainText: string;
  htmlText: string;
}

interface ClipboardBlob {
  text(): Promise<string>;
}

interface ClipboardItemLike {
  types: readonly string[];
  getType(type: string): Promise<ClipboardBlob>;
}

export interface ClipboardLike {
  read?: () => Promise<readonly ClipboardItemLike[]>;
  readText?: () => Promise<string>;
}

async function getClipboardItemText(
  item: ClipboardItemLike,
  type: string,
): Promise<string> {
  const blob = await item.getType(type);
  return blob.text();
}

export async function readClipboardPayload(
  clipboard: ClipboardLike | undefined,
): Promise<ClipboardPayload> {
  if (!clipboard) {
    throw new Error("Clipboard API unavailable");
  }

  let richReadError: unknown = null;

  if (clipboard.read) {
    try {
      const items = await clipboard.read();
      let plainText = "";
      let htmlText = "";

      for (const item of items) {
        const types = Array.from(item.types);

        if (!plainText && types.includes("text/plain")) {
          plainText = await getClipboardItemText(item, "text/plain");
        }
        if (!htmlText && types.includes("text/html")) {
          htmlText = await getClipboardItemText(item, "text/html");
        }
      }

      if (plainText || htmlText || !clipboard.readText) {
        return { plainText, htmlText };
      }
    } catch (error) {
      richReadError = error;
    }
  }

  if (clipboard.readText) {
    try {
      return { plainText: await clipboard.readText(), htmlText: "" };
    } catch (error) {
      if (richReadError instanceof Error) {
        throw richReadError;
      }
      if (error instanceof Error) {
        throw error;
      }
      throw new Error("Clipboard read failed");
    }
  }

  if (richReadError instanceof Error) {
    throw richReadError;
  }
  throw new Error("Clipboard API unavailable");
}
