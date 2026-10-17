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

it("sweeps only stale template dirs left by runs that never tore down", () => {
  const stale = fs.mkdtempSync(PGLITE_TEMPLATE_PREFIX);
  const fresh = fs.mkdtempSync(PGLITE_TEMPLATE_PREFIX);
  try {
    const old = (Date.now() - STALE_TEMPLATE_MS - 60_000) / 1000;
    fs.utimesSync(stale, old, old);
    const swept = sweepStaleTemplates();
    expect(swept).toContain(stale);
    expect(fs.existsSync(stale)).toBe(false);
    expect(fs.existsSync(fresh)).toBe(true);
    // This run's own template is fresh, so it survives too.
    expect(fs.existsSync(inject("pgliteTemplateDir")!)).toBe(true);
  } finally {
    fs.rmSync(stale, { recursive: true, force: true });
    fs.rmSync(fresh, { recursive: true, force: true });
  }
});
