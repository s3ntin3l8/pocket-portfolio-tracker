import { spawnSync } from "node:child_process";
import { copyFile, mkdir, mkdtemp, readFile, readdir, rename, rm } from "node:fs/promises";
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
  // `minCharts`: charts are `next/dynamic` chunks that can mount after
  // `networkidle`; settle() waits until at least this many have drawn. Holdings:
  // hero + allocation donut; insights: composition donut + yearly returns.
  { slug: "holdings", path: "/en/holdings", minCharts: 2 },
  { slug: "activity", path: "/en/transactions" },
  { slug: "insights", path: "/en/insights", minCharts: 2 },
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

/** Which readiness conditions are still unmet; evaluated in the page. */
function pendingConditions(min) {
  const pending = [];
  if (document.querySelector('[aria-busy="true"], [data-chart-loading]'))
    pending.push("chart or data still loading");
  const charts = [...document.querySelectorAll(".recharts-wrapper")];
  const drawn = charts.filter((c) => c.querySelector(".recharts-surface path[d]"));
  // At least `min` charts must have drawn; fewer is fatal by design (timeout +
  // throw), even if the missing ones are mounted but empty. Path-less charts beyond
  // the expected count are legitimately empty (no series) and only warn.
  if (drawn.length < min) pending.push(`${drawn.length}/${min} expected charts drawn`);
  // Couples to the Next dev overlay's private markup (`<nextjs-portal>` shadow root
  // and its "Compiling"/"Building" label). If Next renames either, this check turns
  // vacuous rather than hanging, and the other checks still apply.
  const portal = document.querySelector("nextjs-portal")?.shadowRoot;
  if (/Compiling|Building/.test(portal?.textContent ?? "")) pending.push("dev server compiling");
  return pending;
}

/**
 * Hide the Next.js dev-tools indicator (the round "N" badge in the bottom-left
 * corner, rendered inside `<nextjs-portal>`). The demo runs `next dev`, so without
 * this every capture ships the badge — on narrow it sits on top of the bottom
 * nav's Holdings tab. Called after the settle checks, which still read the portal's
 * "Compiling"/"Building" label; `display: none` keeps the element in the DOM.
 */
export const DEV_INDICATOR_HIDE_CSS = "nextjs-portal { display: none !important; }";

/**
 * Whether the Next dev overlay is reporting an issue (a runtime/build error on the
 * page). Evaluated in the page. Couples to the vendored next-devtools markup: the
 * issues pill is a `[data-issues]` element (label "Issue"/"Issues" + count) inside
 * the `<nextjs-portal>` shadow root; "No issues" (lower-case) is not a hit. If Next
 * renames these, the check turns vacuous rather than failing captures.
 */
export function devOverlayHasIssues() {
  const root = document.querySelector("nextjs-portal")?.shadowRoot;
  if (!root) return false;
  return Boolean(root.querySelector("[data-issues]")) || /\bIssues?\b/.test(root.textContent ?? "");
}

export async function hideDevIndicator(page) {
  await page.addStyleTag({ content: DEV_INDICATOR_HIDE_CSS });
}

export async function settle(page, { slug, minCharts = 0 }) {
  // next/font uses display:"swap" (see layout.tsx) — text paints in a fallback
  // system font first, then swaps once Plus Jakarta Sans/DM Mono finish loading.
  // Without this, captures can race that swap and ship with the wrong font.
  await page.evaluate(() => document.fonts.ready);
  // `networkidle` can fire while the dev server is still compiling a route or a
  // query is in flight, which on a loaded host shipped a hero with no chart.
  // Wait until nothing is loading (loading charts set aria-busy, lazy-chunk
  // skeletons data-chart-loading), the screen's expected charts have mounted and
  // drawn, and Next's dev indicator has stopped compiling; throw rather than
  // capture an empty state.
  const check = `(${pendingConditions.toString()})(${Number(minCharts)})`;
  try {
    await page.waitForFunction(`${check}.length === 0`, null, {
      timeout: 60_000,
      polling: 250,
    });
  } catch (err) {
    const pending = await page.evaluate(check).catch(() => ["page unavailable"]);
    // Some charts are data-gated (e.g. the holdings donut renders only with a
    // positive-value asset class), so a missing chart usually means missing demo data.
    throw new Error(
      `${slug}: page did not settle within 60 s (${pending.join("; ")}); ` +
        `if charts are missing, check that the demo seed populates every expected chart`,
      { cause: err },
    );
  }
  // Let charts/animations settle (recharts entrance transitions).
  await page.waitForTimeout(600);
  // Evaluated after the settle so it describes the frame that gets captured.
  const empty = await page.evaluate(
    () =>
      [...document.querySelectorAll(".recharts-wrapper")].filter(
        (c) => !c.querySelector(".recharts-surface path[d]"),
      ).length,
  );
  if (empty > 0) console.warn(`${slug}: ${empty} chart(s) rendered without data`);
  // Hiding the portal would also hide the overlay's error signal, so a page with a
  // dev error must fail the run here instead of shipping a clean-looking capture.
  if (await page.evaluate(devOverlayHasIssues))
    throw new Error(`${slug}: the Next dev overlay reports an issue — fix the page error first`);
  await hideDevIndicator(page);
}

async function captureReadme(browser, cookie, secure) {
  await mkdir(README_DIR, { recursive: true });
  // Sweep `.<name>.tmp` files a previously killed run may have left mid-flush.
  for (const f of await readdir(README_DIR))
    if (f.startsWith(".") && f.endsWith(".tmp"))
      await rm(path.join(README_DIR, f), { force: true });
  // Capture the whole set into a staging dir outside the repo and copy it in only
  // once every shot succeeded, so an aborted run (e.g. a settle() timeout) can't
  // leave a mix of refreshed and stale screenshots behind, and a killed run can't
  // leave a staging dir inside the served public/ folder.
  const staging = await mkdtemp(path.join(tmpdir(), "pocket-readme-shots-"));
  try {
    const entries = await captureReadmeInto(browser, cookie, secure, staging);
    for (const { filename } of entries) {
      // Copy to a temp name beside the target, then rename: a kill mid-copy can't
      // leave a truncated PNG under the real name.
      const tmp = path.join(README_DIR, `.${filename}.tmp`);
      try {
        await copyFile(path.join(staging, filename), tmp);
        await rename(tmp, path.join(README_DIR, filename));
      } finally {
        await rm(tmp, { force: true });
      }
    }
    return entries;
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
}

async function captureReadmeInto(browser, cookie, secure, outDir) {
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
        await settle(page, screen);
        const filename = `${screen.slug}-${theme}-${factor.name}.png`;
        await page.screenshot({ path: path.join(outDir, filename), fullPage: false });
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
  await settle(page, { slug: "holdings-loop", minCharts: 1 });
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

  const videos = (await readdir(videoDir)).filter((f) => f.endsWith(".webm"));
  if (videos.length !== 1)
    throw new Error(`expected one recording in ${videoDir}, found ${videos.length}`);
  const [raw] = videos;
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
      await settle(page, screen);
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
