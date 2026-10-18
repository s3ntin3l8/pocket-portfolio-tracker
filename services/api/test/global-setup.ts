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
    /**
     * This run's pre-migrated PGlite template; test/setup.ts copies it per file.
     * Optional: setup.ts falls back to a from-scratch DB when it is missing.
     */
    pgliteTemplateDir?: string;
  }
}

/**
 * Prefix of each run's template dir. The owning process's pid follows, then the
 * unique mkdtemp suffix: `<prefix><pid>-XXXXXX`.
 */
export const PGLITE_TEMPLATE_PREFIX = path.join(os.tmpdir(), "portfolio-vitest-pglite-template-");

/** Far longer than any run, so a concurrent run's template is never swept. */
export const STALE_TEMPLATE_MS = 12 * 60 * 60 * 1000;

/** Whether the pid that owns a template dir (from its name) is still running. */
function ownerAlive(name: string, base: string): boolean {
  const pid = Number(/^(\d+)-/.exec(name.slice(base.length))?.[1]);
  if (!Number.isSafeInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    // EPERM: alive, just not ours to signal.
    return (err as NodeJS.ErrnoException).code === "EPERM";
  }
}

/**
 * Remove template dirs left by runs that never reached teardown (cancelled or
 * killed), which a per-run path no longer overwrites. A dir goes only when it is
 * older than STALE_TEMPLATE_MS and its owning process is gone: the mtime freezes
 * once the template is built, so age alone would sweep a long watch session's.
 * The fixed path older versions used (no pid) goes on age alone; a live older run
 * rebuilds it at setup, which refreshes the mtime. `root` is for tests.
 */
export function sweepStaleTemplates({
  root = path.dirname(PGLITE_TEMPLATE_PREFIX),
  now = Date.now(),
}: { root?: string; now?: number } = {}): string[] {
  const base = path.basename(PGLITE_TEMPLATE_PREFIX);
  const legacy = base.replace(/-$/, "");
  const swept: string[] = [];
  for (const name of fs.readdirSync(root)) {
    const isLegacy = name === legacy;
    if (!isLegacy && !name.startsWith(base)) continue;
    const full = path.join(root, name);
    try {
      if (now - fs.statSync(full).mtimeMs < STALE_TEMPLATE_MS) continue;
      if (!isLegacy && ownerAlive(name, base)) continue;
      fs.rmSync(full, { recursive: true, force: true });
      swept.push(full);
    } catch {
      // Gone already, or not ours to remove.
    }
  }
  return swept;
}

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
  sweepStaleTemplates();
  const templateDir = fs.mkdtempSync(`${PGLITE_TEMPLATE_PREFIX}${process.pid}-`);
  let client: PGlite | undefined;
  try {
    client = new PGlite(templateDir, { extensions: { pg_trgm } });
    const db = drizzle(client, {});
    await migrate(db, { migrationsFolder: migrationsDir });
    // Must close cleanly before any file copies from this directory, or the snapshot on
    // disk can be left in an inconsistent state.
    await client.close();
  } catch (err) {
    // A failed setup runs no teardown; do not leave the half-built template behind.
    // Close best-effort first, so a cleanup failure cannot mask the original error.
    await client?.close().catch(() => {});
    fs.rmSync(templateDir, { recursive: true, force: true });
    throw err;
  }
  project.provide("pgliteTemplateDir", templateDir);

  return () => {
    fs.rmSync(templateDir, { recursive: true, force: true });
  };
}
