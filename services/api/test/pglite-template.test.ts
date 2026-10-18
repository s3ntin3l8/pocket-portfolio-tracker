import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, inject, it } from "vitest";
import { PGLITE_TEMPLATE_PREFIX, STALE_TEMPLATE_MS, sweepStaleTemplates } from "./global-setup.js";

// global-setup.ts builds the pre-migrated template once per run. A fixed path would be
// shared by every concurrent run on the host, each deleting and rebuilding it under the
// others; so it is a fresh mkdtemp dir per run, handed to the workers via provide().
it("each run gets its own PGlite template dir, provided to the workers", () => {
  const templateDir = inject("pgliteTemplateDir") ?? "";
  expect(templateDir).not.toBe("");
  expect(templateDir.startsWith(PGLITE_TEMPLATE_PREFIX)).toBe(true);
  expect(templateDir).not.toBe(path.join(os.tmpdir(), "portfolio-vitest-pglite-template"));
  expect(fs.existsSync(path.join(templateDir, "PG_VERSION"))).toBe(true);
});

it("seeds this file's database from the template", () => {
  const dbDir = process.env.DATABASE_URL?.replace(/^pglite:\/\//, "");
  expect(dbDir).toBeTruthy();
  expect(fs.existsSync(path.join(dbDir!, "PG_VERSION"))).toBe(true);
});

it("sweeps only stale template dirs whose owning run is gone", () => {
  // A private root: the real tmpdir is shared with concurrent runs, whose own sweep
  // could remove these fixtures first.
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pglite-sweep-test-"));
  const base = path.basename(PGLITE_TEMPLATE_PREFIX);
  // Above Linux's maximum pid_max (2^22) and any macOS pid: never a live process.
  const deadPid = 4_194_305;
  const dir = (name: string) => {
    const full = path.join(root, name);
    fs.mkdirSync(full);
    return full;
  };
  const stale = dir(`${base}${deadPid}-aaaaaa`);
  // Old, but owned by a live process (a long watch session): kept.
  const watching = dir(`${base}${process.pid}-bbbbbb`);
  const fresh = dir(`${base}${deadPid}-cccccc`);
  // The fixed path older versions used: no pid, so age alone decides.
  const legacy = dir(base.replace(/-$/, ""));
  const unrelated = dir("something-else");
  try {
    const old = (Date.now() - STALE_TEMPLATE_MS - 60_000) / 1000;
    for (const d of [stale, watching, legacy, unrelated]) fs.utimesSync(d, old, old);
    expect(sweepStaleTemplates({ root }).sort()).toEqual([legacy, stale].sort());
    expect(fs.existsSync(watching)).toBe(true);
    expect(fs.existsSync(fresh)).toBe(true);
    expect(fs.existsSync(unrelated)).toBe(true);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

it("never sweeps this run's own template", () => {
  sweepStaleTemplates();
  expect(fs.existsSync(inject("pgliteTemplateDir")!)).toBe(true);
});
