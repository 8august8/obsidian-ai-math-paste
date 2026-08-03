import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync, copyFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { chromium } from "playwright-core";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(scriptDirectory, "..");
const assetsDirectory = join(projectRoot, "assets");
const htmlPath = join(assetsDirectory, "demo.html");
const framesPath = join(assetsDirectory, ".demo-frames");
const gifPath = join(assetsDirectory, "demo.gif");
const posterPath = join(assetsDirectory, "demo-poster.png");

const executableCandidates = process.platform === "win32"
  ? [
      join(process.env.PROGRAMFILES ?? "", "Google", "Chrome", "Application", "chrome.exe"),
      join(process.env["PROGRAMFILES(X86)"] ?? "", "Google", "Chrome", "Application", "chrome.exe"),
      join(process.env.LOCALAPPDATA ?? "", "Google", "Chrome", "Application", "chrome.exe"),
      join(process.env.PROGRAMFILES ?? "", "Microsoft", "Edge", "Application", "msedge.exe"),
    ]
  : process.platform === "darwin"
    ? [
        "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
        "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
        join(homedir(), "Applications", "Google Chrome.app", "Contents", "MacOS", "Google Chrome"),
      ]
    : ["/usr/bin/google-chrome", "/usr/bin/chromium", "/usr/bin/chromium-browser"];

const executablePath = executableCandidates.find((candidate) => candidate && existsSync(candidate));
if (!executablePath) {
  throw new Error("Chrome, Edge, or Chromium was not found.");
}

if (existsSync(framesPath)) {
  const resolvedFrames = resolve(framesPath);
  if (resolvedFrames !== resolve(assetsDirectory, ".demo-frames")) {
    throw new Error(`Refusing to remove unexpected frame directory: ${resolvedFrames}`);
  }
  rmSync(resolvedFrames, { recursive: true, force: true });
}
mkdirSync(framesPath);

const browser = await chromium.launch({
  executablePath,
  headless: true,
  args: ["--disable-background-networking", "--disable-component-update", "--disable-extensions"],
});

try {
  const page = await browser.newPage({ viewport: { width: 1000, height: 562 } });
  const baseUrl = pathToFileURL(htmlPath).toString();

  for (let frame = 0; frame < 48; frame += 1) {
    await page.goto(`${baseUrl}?frame=${frame}`, { waitUntil: "load" });
    await page.screenshot({
      path: join(framesPath, `frame-${String(frame).padStart(3, "0")}.png`),
    });
  }
} finally {
  await browser.close();
}

copyFileSync(join(framesPath, "frame-047.png"), posterPath);

const ffmpeg = spawnSync(
  "ffmpeg",
  [
    "-y",
    "-loglevel",
    "error",
    "-framerate",
    "12",
    "-i",
    join(framesPath, "frame-%03d.png"),
    "-filter_complex",
    "split[s0][s1];[s0]palettegen=max_colors=128[p];[s1][p]paletteuse=dither=bayer:bayer_scale=3",
    "-loop",
    "0",
    gifPath,
  ],
  { encoding: "utf8" },
);

if (ffmpeg.status !== 0 || !existsSync(gifPath)) {
  throw new Error(ffmpeg.stderr || "ffmpeg did not create the demo GIF.");
}

rmSync(framesPath, { recursive: true, force: true });

process.stdout.write(`Created ${gifPath} (${statSync(gifPath).size} bytes)\n`);
process.stdout.write(`Created ${posterPath} (${statSync(posterPath).size} bytes)\n`);
