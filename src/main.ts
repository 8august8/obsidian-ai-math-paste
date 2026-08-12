import {
  htmlToMarkdown,
  MarkdownView,
  Notice,
  Plugin,
  type Editor,
} from "obsidian";
import { readClipboardPayload, type ClipboardLike } from "./clipboard";
import { normalizeMathInRange } from "./degraded-math";
import { normalizeLatexInRange } from "./math-normalizer";
import { resultNotice } from "./notices";
import {
  convertRichClipboardHtml,
  normalizeClipboardText,
  sameTextIgnoringLineEndings,
} from "./rich-clipboard";

const COMMAND_NAME = "Paste and clean AI math";
const NOTICE_DURATION_MS = 2400;

function browserClipboard(): ClipboardLike | undefined {
  return activeWindow.navigator.clipboard;
}

export default class AiMathPastePlugin extends Plugin {
  onload(): void {
    this.addCommand({
      id: "paste-clean-math",
      name: COMMAND_NAME,
      editorCallback: (editor) => {
        void this.adaptText(editor);
      },
    });

    this.addRibbonIcon("sigma", COMMAND_NAME, () => {
      const view = this.app.workspace.getActiveViewOfType(MarkdownView);
      if (!view || view.getMode() !== "source") {
        new Notice("Open a Markdown editing view first", NOTICE_DURATION_MS);
        return;
      }

      void this.adaptText(view.editor);
    });
  }

  private async adaptText(editor: Editor): Promise<void> {
    const selection = editor.getSelection();

    if (selection.length > 0) {
      await this.repairSelection(editor, selection);
      return;
    }

    await this.pasteClipboard(editor);
  }

  private async repairSelection(editor: Editor, selection: string): Promise<void> {
    const from = editor.getCursor("from");
    const to = editor.getCursor("to");
    const source = editor.getValue();
    const start = editor.posToOffset(from);
    const end = editor.posToOffset(to);
    let richSelectionResult = null;

    try {
      const payload = await readClipboardPayload(browserClipboard());
      const richResult = convertRichClipboardHtml(payload.htmlText, htmlToMarkdown);

      if (
        richResult &&
        (sameTextIgnoringLineEndings(selection, payload.plainText) ||
          sameTextIgnoringLineEndings(selection, richResult.originalMarkdown))
      ) {
        richSelectionResult = {
          ...normalizeLatexInRange(richResult.restoredMarkdown),
          webRestoredCount: richResult.restoredCount,
          skippedWebFormulaCount: richResult.skippedCount,
        };
      }
    } catch {
      // Rich clipboard evidence is optional when repairing existing text.
    }

    if (
      editor.getValue() !== source ||
      editor.posToOffset(editor.getCursor("from")) !== start ||
      editor.posToOffset(editor.getCursor("to")) !== end
    ) {
      new Notice("The note changed while reading the clipboard. Try again.", NOTICE_DURATION_MS);
      return;
    }

    const result = richSelectionResult ?? normalizeMathInRange(source, start, end);
    result.changed = result.text !== selection;

    if (result.changed) {
      editor.replaceRange(result.text, from, to);
    }

    new Notice(resultNotice(result, false), NOTICE_DURATION_MS);
  }

  private async pasteClipboard(editor: Editor): Promise<void> {
    let payload;

    try {
      payload = await readClipboardPayload(browserClipboard());
    } catch {
      new Notice("Could not read the clipboard. Check system permissions.", NOTICE_DURATION_MS);
      return;
    }

    if (!payload.plainText && !payload.htmlText) {
      new Notice("The clipboard is empty", NOTICE_DURATION_MS);
      return;
    }

    const result = normalizeClipboardText(payload.plainText, payload.htmlText, {
      convertHtmlToMarkdown: htmlToMarkdown,
    });
    editor.replaceRange(result.text, editor.getCursor());
    new Notice(resultNotice(result, true), NOTICE_DURATION_MS);
  }
}
