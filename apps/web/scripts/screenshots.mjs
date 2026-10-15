import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, readdir, rename, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";
import { mintSessionCookie } from "./mint-session.mjs";

/**
 * Screenshot driver for the reproducible demo pipeline. The orchestrator
 * (`scripts/screenshots.mjs` at the repo root) seeds data and boots an isolated
 * API/web pair before calling this.
 *
 * Profiles (SCREENSHOTS_PROFILE):
 *  - `readme` (default): the Hero-5 screens × {light, dark} × {narrow, wide} into
 *    `apps/web/public/screenshots/`, the source for the README embeds and the PWA
 *    manifest `screenshots` array (issue #100).
 *  - `landing`: dark-only 2× stills sized for the s3ntin3l8.de landing page, plus a
 *    short silent loop of the holdings chart switching ranges (webm + mp4 + poster,
 *    needs ffmpeg on PATH). Written to SCREENSHOTS_OUT_DIR.
 *
 * Auth: mints a forged Auth.js session cookie from the seeded personal-access token
 * (see `mint-session.mjs` for why this is safe and how it works); no real login.
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const README_DIR = path.resolve(__dirname, "../public/screenshots");

const WEB_URL = process.env.SCREENSHOTS_WEB_URL ?? "http://localhost:3005";
const PAT_FILE = process.env.SCREENSHOTS_PAT_FILE;
const AUTH_SECRET = process.env.AUTH_SECRET;
const AUTH_SUB = process.env.SCREENSHOTS_AUTH_SUB ?? "demo|pocket";
const PROFILE = process.env.SCREENSHOTS_PROFILE ?? "readme";

// The Pocket 5-tab IA (see nav-items.tsx): Holdings is the home/net-worth screen
// (the old standalone "/dashboard" now just redirects here — see
// dashboard/page.tsx), Activity is the transaction ledger, Reports/Insights/Tax
// round out the hero set with the app's other visually distinct screens. Tax is a
// leaf under the Reports tab, not a top-level nav item, but is rich enough (FSA
// allowance, realized gains, harvest suggestions) to be worth its own capture.
const SCREENS = [
  { slug: "holdings", path: "/en/holdings" },
  { slug: "activity", path: "/en/transactions" },
  { slug: "insights", path: "/en/insights" },
  { slug: "reports", path: "/en/reports" },
  { slug: "tax", path: "/en/tax" },
];

const THEMES = ["light", "dark"];

// "narrow" MUST be under the app's `md:` breakpoint (768px CSS px — see
// app-shell.tsx/bottom-nav.tsx's `md:hidden`/`md:flex`), or the desktop sidebar
// layout renders instead of the real single-column/bottom-nav mobile UI. A real
// phone logical size (iPhone 11/XR: 414×896) at 2x device-scale gives a crisp,
// representative capture of what a phone install actually looks like.
const FACTORS = [
  { name: "narrow", width: 414, height: 896, deviceScaleFactor: 2, form_factor: "narrow" },
  { name: "wide", width: 2560, height: 1440, deviceScaleFactor: 1, form_factor: "wide" },
];

// Landing profile: one desktop size at 2× (crisp when the page zooms into crops)
// and one phone size at 3×, dark only. Matches the shared spec in personal-landing.
const LANDING_FACTORS = [
  { name: "desktop", width: 1600, height: 1000, deviceScaleFactor: 2 },
  { name: "mobile", width: 390, height: 844, deviceScaleFactor: 3 },
];
// Day-grained chips only: 1D/7D are hidden when there are no intraday snapshots,
// which the demo seed doesn't create.
const LANDING_RANGES = ["1M", "All", "1Y"];

async function newContext(browser, cookie, secure, theme, options) {
  const context = await browser.newContext({ colorScheme: theme, ...options });
  await context.addCookies([
    {
      name: cookie.name,
      value: cookie.value,
      domain: new URL(WEB_URL).hostname,
      path: "/",
      httpOnly: true,
      secure,
      sameSite: "Lax",
    },
  ]);
  // next-themes reads this synchronously before hydration (its inline
  // FOUC-prevention script) — set it before the very first navigation so the
  // `class="dark"|"light"` on <html> is correct from first paint, not just
  // after a client-side re-render.
  await context.addInitScript((t) => {
    window.localStorage.setItem("theme", t);
  }, theme);
  return context;
}

async function settle(page) {
  // next/font uses display:"swap" (see layout.tsx) — text paints in a fallback
  // system font first, then swaps once Plus Jakarta Sans/DM Mono finish loading.
  // Without this, captures can race that swap and ship with the wrong font.
  await page.evaluate(() => document.fonts.ready);
  // Let charts/animations settle (recharts entrance transitions, skeleton→data).
  await page.waitForTimeout(600);
}

async function captureReadme(browser, cookie, secure) {
  await mkdir(README_DIR, { recursive: true });
  const manifestEntries = [];
  for (const factor of FACTORS) {
    for (const theme of THEMES) {
      const context = await newContext(browser, cookie, secure, theme, {
        viewport: { width: factor.width, height: factor.height },
        deviceScaleFactor: factor.deviceScaleFactor,
      });
      const page = await context.newPage();
      for (const screen of SCREENS) {
        await page.goto(`${WEB_URL}${screen.path}`, { waitUntil: "networkidle" });
        await settle(page);
        const filename = `${screen.slug}-${theme}-${factor.name}.png`;
        await page.screenshot({ path: path.join(README_DIR, filename), fullPage: false });
        console.log(`captured ${filename}`);
        manifestEntries.push({
          filename,
          slug: screen.slug,
          theme,
          width: factor.width,
          height: factor.height,
          form_factor: factor.form_factor,
        });
      }
      await context.close();
    }
  }
  return manifestEntries;
}

function ffmpeg(args) {
  const res = spawnSync("ffmpeg", ["-y", "-loglevel", "error", ...args], { stdio: "inherit" });
  if (res.error || res.status !== 0) throw new Error(`ffmpeg ${args.join(" ")} failed`);
}

/** Records the holdings chart cycling through ranges; returns written files. */
async function recordLoop(browser, cookie, secure, outDir) {
  if (spawnSync("ffmpeg", ["-version"]).status !== 0) {
    console.warn("ffmpeg not found; skipping the landing loop");
    return [];
  }
  // Playwright records video in viewport (CSS) pixels regardless of
  // deviceScaleFactor, so the loop is 1× while the stills are 2×. Fine for a
  // muted background loop and keeps the file small.
  const size = { width: 1600, height: 1000 };
  const videoDir = await mkdtemp(path.join(tmpdir(), "pocket-loop-"));
  const context = await newContext(browser, cookie, secure, "dark", {
    viewport: size,
    deviceScaleFactor: 1,
    recordVideo: { dir: videoDir, size },
  });
  const started = Date.now();
  const page = await context.newPage();
  await page.goto(`${WEB_URL}/en/holdings`, { waitUntil: "networkidle" });
  await settle(page);
  const offset = (Date.now() - started) / 1000;
  for (const range of LANDING_RANGES) {
    const chip = page
      .locator("button, [role=tab], [role=radio]")
      .filter({ hasText: new RegExp(`^${range}$`, "i") })
      .first();
    if (!(await chip.isVisible())) {
      console.warn(`range chip ${range} not shown; skipping it in the loop`);
      continue;
    }
    await chip.click();
    await page.waitForTimeout(1600);
  }
  await context.close();

  const [raw] = await readdir(videoDir);
  const src = path.join(videoDir, raw);
  const base = path.join(outDir, "holdings-range");
  const trim = ["-ss", offset.toFixed(2), "-i", src, "-an"];
  ffmpeg([
    ...trim,
    "-c:v",
    "libvpx-vp9",
    "-crf",
    "36",
    "-b:v",
    "0",
    "-row-mt",
    "1",
    `${base}.webm`,
  ]);
  ffmpeg([
    ...trim,
    "-c:v",
    "libx264",
    "-crf",
    "26",
    "-pix_fmt",
    "yuv420p",
    "-movflags",
    "+faststart",
    `${base}.mp4`,
  ]);
  ffmpeg(["-ss", offset.toFixed(2), "-i", src, "-frames:v", "1", "-q:v", "3", `${base}.jpg`]);
  await rm(videoDir, { recursive: true, force: true });
  return ["holdings-range.webm", "holdings-range.mp4", "holdings-range.jpg"];
}

async function captureLanding(browser, cookie, secure) {
  const outDir = process.env.SCREENSHOTS_OUT_DIR;
  if (!outDir) throw new Error("SCREENSHOTS_OUT_DIR is required for the landing profile");
  await mkdir(outDir, { recursive: true });
  const written = [];
  for (const factor of LANDING_FACTORS) {
    const context = await newContext(browser, cookie, secure, "dark", {
      viewport: { width: factor.width, height: factor.height },
      deviceScaleFactor: factor.deviceScaleFactor,
    });
    const page = await context.newPage();
    for (const screen of SCREENS) {
      await page.goto(`${WEB_URL}${screen.path}`, { waitUntil: "networkidle" });
      await settle(page);
      const filename = `${screen.slug}-${factor.name}.png`;
      // Write-then-rename so a crashed run never leaves a half-written file.
      const tmp = path.join(outDir, `.${filename}`);
      await page.screenshot({ path: tmp, fullPage: false });
      await rename(tmp, path.join(outDir, filename));
      written.push(filename);
      console.log(`captured ${filename}`);
    }
    await context.close();
  }
  written.push(...(await recordLoop(browser, cookie, secure, outDir)));
  return written;
}

async function main() {
  if (!PAT_FILE) throw new Error("SCREENSHOTS_PAT_FILE env var is required");
  if (!AUTH_SECRET) throw new Error("AUTH_SECRET env var is required");
  if (!["readme", "landing"].includes(PROFILE))
    throw new Error(`unknown SCREENSHOTS_PROFILE "${PROFILE}" (readme | landing)`);

  const patSecret = (await readFile(PAT_FILE, "utf8")).trim();
  const secure = WEB_URL.startsWith("https://");
  const cookie = await mintSessionCookie({
    patSecret,
    authSub: AUTH_SUB,
    secret: AUTH_SECRET,
    secure,
  });

  const browser = await chromium.launch();
  try {
    return PROFILE === "landing"
      ? await captureLanding(browser, cookie, secure)
      : await captureReadme(browser, cookie, secure);
  } finally {
    await browser.close();
  }
}

const invokedDirectly = process.argv[1] && import.meta.url === `file://${process.argv[1]}`;
if (invokedDirectly) {
  const entries = await main();
  console.log(`Done — ${entries.length} files written (${PROFILE} profile)`);
}

export { main, SCREENS, THEMES, FACTORS, LANDING_FACTORS, README_DIR as OUT_DIR };
