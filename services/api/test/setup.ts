import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import crypto from "node:crypto";
import { afterAll } from "vitest";
import { PGLITE_TEMPLATE_DIR } from "./global-setup.js";

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
if (fs.existsSync(PGLITE_TEMPLATE_DIR)) {
  fs.cpSync(PGLITE_TEMPLATE_DIR, tmpDir, { recursive: true });
}

process.env.DATABASE_URL = `pglite://${tmpDir}`;

afterAll(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});
