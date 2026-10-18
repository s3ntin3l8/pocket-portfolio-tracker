import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import crypto from "node:crypto";
import { afterAll, inject } from "vitest";

// Give every test file an isolated, file-backed PGlite database so close/reopen
// within a file preserves data and parallel workers never contend. Tests that
// need specific values (e.g. the env defaults test) override or delete this.
const tmpDir = path.join(
  os.tmpdir(),
  `vitest-pglite-${process.pid}-${crypto.randomBytes(4).toString("hex")}`,
);

// Seed from the pre-migrated template built once in global-setup.ts, instead of
// letting the DB layer bootstrap a fresh PGlite cluster + replay all migrations for
// every file (~1.4s vs ~0.13s per file). ensureDb() still calls migrate() as usual —
// against an already-migrated dir that's a no-op, so this is transparent to callers.
// Falls back to today's from-scratch path if the template is missing for any reason
// (e.g. global-setup didn't run), so this degrades safely rather than breaking tests.
const templateDir = inject("pgliteTemplateDir");
if (templateDir && fs.existsSync(templateDir)) {
  fs.cpSync(templateDir, tmpDir, { recursive: true });
}

process.env.DATABASE_URL = `pglite://${tmpDir}`;

afterAll(async () => {
  // Close a database the file left open first: deleting the data dir under a live
  // PGlite makes its pending I/O fail with ENOENT (errno 44) as an unhandled rejection
  // that fails the whole run. Imported lazily, so files that never touch the DB don't
  // load the client.
  // Best-effort: some files mock the client module, so closeDb may be absent or a stub.
  try {
    const client = await import("../src/db/client.js");
    await client.closeDb?.();
  } catch {
    // Nothing open, or nothing closable: the delete below is all that is left.
  }
  fs.rmSync(tmpDir, { recursive: true, force: true });
});
