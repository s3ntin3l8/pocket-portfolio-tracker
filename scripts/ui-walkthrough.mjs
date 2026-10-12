#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { chromium } from "@playwright/test";

/**
 * Route-by-route UI walkthrough used for the 2026-10-12 app audit
 * (`docs/audits/2026-10-12-app-audit.md`). Visits every app route at phone / tablet /
 * desktop widths (+ a dark-mode desktop sample), saves a full-page screenshot per route
 * and writes `findings.json` with per-route metrics: HTTP status, console errors, failed
 * requests, horizontal overflow, `<h1>` count, unnamed buttons, unlabelled inputs,
 * sub-32px hit targets, landmarks (skip link / main / nav), navigation timing and JS
 * transfer size.
 *
 * Prerequisites: a running dev stack with the dev-auth bypass (`make dev` with
 * `DEV_AUTH_TOKEN` set, as `.env.example` does) — routes are then loadable without a
 * login. Unlike `scripts/screenshots.mjs` this does NOT boot its own isolated instance;
 * it is a diagnostic for the stack you already have running.
 *
 * Usage:
 *   node scripts/ui-walkthrough.mjs [outDir]            # default ./walkthrough-out
 *   PAUSE_MS=8000 node scripts/ui-walkthrough.mjs        # pace requests (see below)
 *   VIEWPORTS=mobile,desktop node scripts/ui-walkthrough.mjs
 *   WALK_WEB_URL=http://localhost:3005                   # default
 *
 * PAUSE_MS: until audit finding D1 (rate-limit bucket shared by all server-side
 * fetches) is fixed, an unpaced run trips the API's default 100 req/min limit after a
 * handful of routes and every later page renders "Can't reach the API". ~8 s between
 * routes keeps a run under the limit. Once D1 ships, `PAUSE_MS=0` is the verification.
 *
 * PLAYWRIGHT_BROWSERS_PATH: optional — point it at an existing Playwright browser cache
 * if `npx playwright install chromium` is not an option on the host.
 */

const BASE = process.env.WALK_WEB_URL || "http://localhost:3005";
const OUT = process.argv[2] || "./walkthrough-out";
const PAUSE_MS = Number(process.env.PAUSE_MS || 0);
const VP_FILTER = (process.env.VIEWPORTS || "").split(",").filter(Boolean);
fs.mkdirSync(OUT, { recursive: true });

const routes = [
  "/en",
  "/en/holdings",
  "/en/transactions",
  "/en/reports",
  "/en/insights",
  "/en/income",
  "/en/trades",
  "/en/savings",
  "/en/tax",
  "/en/reports/documents",
  "/en/settings",
  "/en/settings/portfolios",
  "/en/settings/account",
  "/en/settings/investing",
  "/en/settings/connections",
  "/en/admin",
  "/en/admin/jobs",
  "/en/onboarding",
  "/id/holdings",
  "/id/insights",
];

const viewports = [
  { name: "mobile", width: 390, height: 844, dpr: 2, isMobile: true, hasTouch: true },
  { name: "tablet", width: 820, height: 1180, dpr: 2, isMobile: true, hasTouch: true },
  { name: "desktop", width: 1440, height: 900, dpr: 1, isMobile: false, hasTouch: false },
];

/** Runs inside the page: cheap structural/a11y/perf probes, no external deps. */
const audit = () => {
  const r = {};
  r.title = document.title;
  r.h1 = [...document.querySelectorAll("h1")].map((h) => h.textContent.trim()).filter(Boolean);
  r.hOverflow = document.documentElement.scrollWidth - window.innerWidth;
  const overflowing = [];
  for (const el of document.querySelectorAll("body *")) {
    const b = el.getBoundingClientRect();
    if (
      b.width > 0 &&
      b.right > window.innerWidth + 1 &&
      getComputedStyle(el).position !== "fixed"
    ) {
      overflowing.push((el.tagName + "." + (el.className?.toString?.() || "")).slice(0, 80));
      if (overflowing.length > 8) break;
    }
  }
  r.overflowing = overflowing;
  const name = (el) =>
    (
      el.getAttribute("aria-label") ||
      el.getAttribute("aria-labelledby") ||
      el.getAttribute("title") ||
      el.textContent ||
      ""
    ).trim();
  r.unnamedButtons = [...document.querySelectorAll("button, a[href], [role=button]")]
    .filter((el) => !name(el) && !el.querySelector('img[alt]:not([alt=""])'))
    .map((el) => (el.outerHTML || "").slice(0, 120))
    .slice(0, 10);
  r.unlabeledInputs = [...document.querySelectorAll("input:not([type=hidden]), select, textarea")]
    .filter((el) => {
      const id = el.id;
      const hasLabel = id && document.querySelector('label[for="' + CSS.escape(id) + '"]');
      return !(
        hasLabel ||
        el.getAttribute("aria-label") ||
        el.getAttribute("aria-labelledby") ||
        el.closest("label")
      );
    })
    .map((el) => (el.outerHTML || "").slice(0, 120))
    .slice(0, 10);
  const small = [];
  for (const el of document.querySelectorAll(
    "button, a[href], [role=button], input[type=checkbox], [role=switch]",
  )) {
    const b = el.getBoundingClientRect();
    if (b.width > 0 && b.height > 0 && (b.width < 32 || b.height < 32)) {
      small.push({
        n: name(el).slice(0, 30) || el.tagName,
        w: Math.round(b.width),
        h: Math.round(b.height),
      });
      if (small.length > 12) break;
    }
  }
  r.smallTargets = small;
  r.imgNoAlt = document.querySelectorAll("img:not([alt])").length;
  r.landmarks = {
    main: document.querySelectorAll("main").length,
    nav: document.querySelectorAll("nav").length,
    skip: !!document.querySelector('a[href="#main"], a[href="#content"], .skip-link'),
  };
  const nav = performance.getEntriesByType("navigation")[0];
  r.timing = nav
    ? {
        ttfb: Math.round(nav.responseStart),
        dcl: Math.round(nav.domContentLoadedEventEnd),
        load: Math.round(nav.loadEventEnd),
        transfer: nav.transferSize,
      }
    : null;
  const res = performance.getEntriesByType("resource");
  r.resources = {
    count: res.length,
    js: res.filter((x) => x.name.endsWith(".js") || x.initiatorType === "script").length,
    jsBytes: res
      .filter((x) => x.name.includes(".js"))
      .reduce((s, x) => s + (x.transferSize || 0), 0),
    api: res.filter((x) => x.name.includes("/api/backend")).length,
  };
  r.text = document.body.innerText.slice(0, 1500);
  return r;
};

const browser = await chromium.launch();
const findings = [];
for (const vp of viewports) {
  if (VP_FILTER.length && !VP_FILTER.includes(vp.name)) continue;
  const ctx = await browser.newContext({
    viewport: { width: vp.width, height: vp.height },
    deviceScaleFactor: vp.dpr,
    isMobile: vp.isMobile,
    hasTouch: vp.hasTouch,
    colorScheme: "light",
  });
  const page = await ctx.newPage();
  const consoleMsgs = [];
  const failed = [];
  page.on("console", (m) => {
    if (["error", "warning"].includes(m.type()))
      consoleMsgs.push(m.type() + ": " + m.text().slice(0, 300));
  });
  page.on("pageerror", (e) => consoleMsgs.push("pageerror: " + String(e).slice(0, 300)));
  page.on("requestfailed", (r) => failed.push(r.url().slice(0, 200)));
  page.on("response", (r) => {
    if (r.status() >= 400) failed.push(r.status() + " " + r.url().slice(0, 200));
  });

  const list = [...routes];
  let instrumentDiscovered = false;
  for (let i = 0; i < list.length; i++) {
    const route = list[i];
    consoleMsgs.length = 0;
    failed.length = 0;
    if (PAUSE_MS) await page.waitForTimeout(PAUSE_MS);
    const t0 = Date.now();
    let status;
    try {
      const resp = await page.goto(BASE + route, { waitUntil: "networkidle", timeout: 60000 });
      status = resp?.status() ?? null;
    } catch (e) {
      findings.push({ vp: vp.name, route, error: String(e).slice(0, 200) });
      continue;
    }
    await page.waitForTimeout(800);
    const wall = Date.now() - t0;
    const r = await page.evaluate(audit);
    const file = `${vp.name}__${route.replace(/[^a-z0-9]+/gi, "_")}.jpg`;
    await page.screenshot({
      path: path.join(OUT, file),
      fullPage: true,
      type: "jpeg",
      quality: 55,
    });
    findings.push({
      vp: vp.name,
      route,
      status,
      wall,
      file,
      console: [...consoleMsgs],
      failed: [...failed],
      ...r,
    });
    // Discover one instrument detail page from the holdings list (ids are per-seed).
    if (route === "/en/holdings" && !instrumentDiscovered) {
      instrumentDiscovered = true;
      const href = await page.evaluate(() =>
        document.querySelector('a[href*="/instruments/"]')?.getAttribute("href"),
      );
      if (href && !list.includes(href)) list.push(href);
    }
  }
  await ctx.close();

  if (vp.name === "desktop") {
    const dctx = await browser.newContext({
      viewport: { width: vp.width, height: vp.height },
      colorScheme: "dark",
    });
    const dp = await dctx.newPage();
    for (const route of ["/en/holdings", "/en/insights", "/en/transactions"]) {
      if (PAUSE_MS) await dp.waitForTimeout(PAUSE_MS);
      await dp.goto(BASE + route, { waitUntil: "networkidle", timeout: 60000 }).catch(() => {});
      await dp.evaluate(() => {
        try {
          localStorage.setItem("theme", "dark");
          document.documentElement.classList.add("dark");
        } catch {
          /* ignore */
        }
      });
      await dp.waitForTimeout(500);
      await dp.screenshot({
        path: path.join(OUT, `desktop-dark__${route.replace(/[^a-z0-9]+/gi, "_")}.jpg`),
        fullPage: true,
        type: "jpeg",
        quality: 55,
      });
    }
    await dctx.close();
  }
}
await browser.close();
fs.writeFileSync(path.join(OUT, "findings.json"), JSON.stringify(findings, null, 1));

// Console summary: one line per route with the flags a reviewer acts on.
for (const r of findings) {
  if (r.error) {
    console.log(`${r.vp.padEnd(7)} ${r.route} ERROR ${r.error}`);
    continue;
  }
  const flags = [];
  if (r.status !== 200) flags.push(`status=${r.status}`);
  if (/reach the API|Tidak dapat|not found/i.test(r.text)) flags.push("UNAVAILABLE-COPY");
  if (r.hOverflow > 0) flags.push(`hOverflow=${r.hOverflow}`);
  if (r.h1.length !== 1) flags.push(`h1=${r.h1.length}`);
  if (r.console.length) flags.push(`console=${r.console.length}`);
  if (r.unnamedButtons.length) flags.push(`unnamed=${r.unnamedButtons.length}`);
  if (r.unlabeledInputs.length) flags.push(`unlabeled=${r.unlabeledInputs.length}`);
  if (r.smallTargets.length) flags.push(`small=${r.smallTargets.length}`);
  if (!r.landmarks.skip) flags.push("noskip");
  console.log(
    `${r.vp.padEnd(7)} ${r.route.padEnd(34)} ${String(r.wall).padStart(5)}ms ttfb=${r.timing?.ttfb} | ${flags.join(" | ")}`,
  );
}
console.log(`\n${findings.length} captures → ${OUT}/findings.json`);
