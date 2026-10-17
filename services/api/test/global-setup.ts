import path from "node:path";
import os from "node:os";
import fs from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import type { TestProject } from "vitest/node";
import { migrationsDir } from "@portfolio/db";

declare module "vitest" {
  export interface ProvidedContext {
    /** This run's pre-migrated PGlite template; test/setup.ts copies it per file. */
    pgliteTemplateDir: string;
  }
}

/** Prefix of each run's template dir (mkdtemp appends a unique suffix). */
export const PGLITE_TEMPLATE_PREFIX = path.join(os.tmpdir(), "portfolio-vitest-pglite-template-");

/**
 * Runs once per `services/api` project run, in Vitest's main process, before any test
 * worker spawns. Builds one fully-migrated PGlite data directory that test/setup.ts
 * copies into each file's own tmp dir instead of every one of the ~55 DB-backed test
 * files independently bootstrapping a fresh PGlite cluster + replaying all 60
 * migrations (measured at ~1.4s per file; copying a pre-built dir instead measured at
 * ~0.13s — a ~10x reduction, with each copy fully independent of the template and of
 * every other copy).
 *
 * The directory is unique per run and handed to the workers via `provide`: a fixed
 * path is shared by every concurrent run on the host (other checkouts or worktrees),
 * and each run's setup would delete and rebuild it under the others' feet.
 */
export default async function setup(project: TestProject): Promise<() => void> {
  const templateDir = fs.mkdtempSync(PGLITE_TEMPLATE_PREFIX);
  try {
    const client = new PGlite(templateDir, { extensions: { pg_trgm } });
    const db = drizzle(client, {});
    await migrate(db, { migrationsFolder: migrationsDir });
    // Must close cleanly before any file copies from this directory, or the snapshot on
    // disk can be left in an inconsistent state.
    await client.close();
  } catch (err) {
    // A failed setup runs no teardown; do not leave the half-built template behind.
    fs.rmSync(templateDir, { recursive: true, force: true });
    throw err;
  }
  project.provide("pgliteTemplateDir", templateDir);

  return () => {
    fs.rmSync(templateDir, { recursive: true, force: true });
  };
}
