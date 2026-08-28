import { describe, it, expect, afterEach } from "vitest";
import { eq } from "drizzle-orm";
import { users } from "@portfolio/db";
import { ensureDb, getDb, closeDb } from "../../src/db/client.js";

/**
 * SEED_EMAIL/SEED_PASSWORD (and DEMO_AUTH_SUB, which depends on them) are read from
 * `process.env` once at module load — set the env before this file's first (and only)
 * import of seed-demo.ts so the module-level constants pick it up.
 */
process.env.SEED_DEMO_EMAIL = "seed-demo-admin-test@example.com";
process.env.SEED_DEMO_PASSWORD = "bootstrap-password"; // pragma: allowlist secret
const { seedDemo } = await import("../../src/db/seed-demo.js");

describe("seedDemo — admin bootstrap", () => {
  afterEach(async () => {
    await getDb().delete(users).where(eq(users.email, "seed-demo-admin-test@example.com"));
    await closeDb();
  });

  it("seeds the demo user as admin when a local password is set", async () => {
    await ensureDb();
    // `make seed-demo-login SEED_DEMO_PASSWORD=...` (README/.env.example) is the
    // documented alternative to POST /auth/local/setup for bootstrapping a self-host —
    // it must produce an admin, or GET /auth/local/setup-status (which closes the
    // moment any user exists) permanently locks the deployment out of /admin/*.
    await seedDemo();

    const [row] = await getDb()
      .select({ isAdmin: users.isAdmin, authSub: users.authSub })
      .from(users)
      .where(eq(users.email, "seed-demo-admin-test@example.com"));
    expect(row.isAdmin).toBe(true);
    expect(row.authSub).toBe("local|seed-demo-admin-test@example.com");
  }, 30_000);
});
