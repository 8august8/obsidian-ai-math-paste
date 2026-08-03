# AI Math Paste

Paste math from AI assistants and the web into Obsidian without duplicated formulas or broken LaTeX delimiters.

![AI Math Paste before and after demo](assets/demo.gif)

AI Math Paste is a small, local-only Obsidian desktop plugin. It reads the rich HTML already present on your clipboard, recovers LaTeX from MathML annotations, removes duplicate visual layers, and writes clean Obsidian Markdown.

## Why it exists

Copying rendered math from an AI chat can put three representations of the same formula on the clipboard:

```text
τ\tauτ
BBB
z0,iz_{0,i}z0,i
```

When the clipboard includes reliable `application/x-tex` annotations, AI Math Paste recovers:

```markdown
$\tau$
$B$
$z_{0,i}$
```

It also converts `\(...\)` to `$...$` and `\[...\]` to `$$...$$` while preserving code blocks, inline code, lists, blockquotes, tables, and existing dollar-delimited math.

## Use

1. Copy text containing math from an AI chat or web page.
2. Place the cursor in a Markdown editing view.
3. Run **Paste and clean AI math** from the command palette or click the sigma ribbon icon.

If text is selected, the same command repairs the selection instead of inserting new text.

Obsidian community plugins should not define default hotkeys. A convenient personal binding is:

- Windows: `Ctrl+Alt+V`
- macOS: `Cmd+Option+V`

## Evidence-first behavior

- With a TeX annotation in rich clipboard HTML, the plugin replaces the entire rendered formula node with its canonical LaTeX.
- Without that evidence, it only performs safe delimiter conversion.
- It does not guess that ordinary text such as `BBB` is math.

## Compatibility

- Desktop only in the first release.
- Tested on Windows with ChatGPT/Codex rich clipboard output.
- Other sites work when their clipboard HTML includes MathML or KaTeX TeX annotations. Reports and fixtures for Claude, Gemini, DeepSeek, Perplexity, and academic websites are welcome.

## Privacy

AI Math Paste runs entirely inside Obsidian. It has no AI API, network requests, accounts, analytics, or telemetry. Clipboard content is processed in memory and is not stored by the plugin.

## Install

The initial community-directory submission is in preparation. During beta testing, install the latest GitHub release with [BRAT](https://github.com/TfTHacker/obsidian42-brat) using this repository URL:

```text
https://github.com/8august8/obsidian-ai-math-paste
```

## Development

```bash
npm install
npm run check
```

`npm run check` runs linting, unit tests, type checking, and the production build. The generated `main.js` is attached to GitHub releases and is intentionally not committed.

## License

[MIT](LICENSE)

中文说明见 [README.zh-CN.md](README.zh-CN.md)。
