import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, inject, it } from "vitest";
import { PGLITE_TEMPLATE_PREFIX } from "./global-setup.js";

// global-setup.ts builds the pre-migrated template once per run. A fixed path would be
// shared by every concurrent run on the host, each deleting and rebuilding it under the
// others; so it is a fresh mkdtemp dir per run, handed to the workers via provide().
it("each run gets its own PGlite template dir, provided to the workers", () => {
  const templateDir = inject("pgliteTemplateDir");
  expect(typeof templateDir).toBe("string");
  expect(templateDir.startsWith(PGLITE_TEMPLATE_PREFIX)).toBe(true);
  expect(templateDir).not.toBe(path.join(os.tmpdir(), "portfolio-vitest-pglite-template"));
  expect(fs.existsSync(path.join(templateDir, "PG_VERSION"))).toBe(true);
});

it("seeds this file's database from the template", () => {
  const dbDir = process.env.DATABASE_URL?.replace(/^pglite:\/\//, "");
  expect(dbDir).toBeTruthy();
  expect(fs.existsSync(path.join(dbDir!, "PG_VERSION"))).toBe(true);
});
