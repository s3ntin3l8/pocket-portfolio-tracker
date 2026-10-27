import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, afterEach, afterAll } from "vitest";
import { users, apiTokens } from "@portfolio/db";
import { buildApp } from "../../src/app.js";
import { closeDb } from "../../src/db/client.js";
import { hashToken, PAT_PREFIX } from "../../src/plugins/auth.js";

describe("NODE_ENV default is fail-closed", () => {
  const saved = process.env.NODE_ENV;
  afterEach(() => {
    if (saved === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = saved;
  });

  async function patIsAdmin(nodeEnv: string | undefined, sub: string): Promise<boolean> {
    if (nodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = nodeEnv;
    const app = await buildApp();
    try {
      const [u] = await app.db
        .insert(users)
        .values({ authSub: sub, email: `${sub}@example.com` })
        .returning();
      const token = `${PAT_PREFIX}${sub}-env-test`;
      await app.db.insert(apiTokens).values({
        userId: u.id,
        name: "env-test",
        tokenHash: hashToken(token),
        tokenPrefix: token.slice(0, 8),
        scope: "read",
      });
      const res = await app.inject({
        method: "GET",
        url: "/me",
        headers: { authorization: `Bearer ${token}` },
      });
      expect(res.statusCode).toBe(200);
      return (res.json() as { isAdmin: boolean }).isAdmin;
    } finally {
      await app.close();
    }
  }

  it("defaults to production and a PAT is not admin when NODE_ENV is unset", async () => {
    // @fastify/env reads cwd/.env. A developer's own file (the README
    // `cp .env.example .env`) must not be the fixture: truncating it and
    // restoring later loses the file if the process is killed mid-test.
    // A fresh directory is the cwd for this boot only, so the planted
    // NODE_ENV=development is always what a reverted `dotenv:` gate would
    // load, and CI still fails that regression (#1154).
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ppt-env-"));
    const previousCwd = process.cwd();
    try {
      // process.chdir throws ERR_WORKER_UNSUPPORTED_OPERATION under Vitest's
      // threads pool. The repo doesn't pin `pool`; this relies on the forks default.
      process.chdir(dir);
      fs.writeFileSync(path.join(dir, ".env"), "NODE_ENV=development\n", {
        flag: "wx",
        mode: 0o600,
      });
      expect(await patIsAdmin(undefined, "env-unset")).toBe(false);
    } finally {
      process.chdir(previousCwd);
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("a PAT is admin only when NODE_ENV is explicitly development", async () => {
    expect(await patIsAdmin("development", "env-dev")).toBe(true);
  });
});

afterAll(async () => {
  await closeDb();
});
