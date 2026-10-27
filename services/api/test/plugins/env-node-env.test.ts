import fs from "node:fs";
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
    // The README setup (`cp .env.example .env`) puts NODE_ENV=development in that
    // file, and @fastify/env reads cwd/.env. Plant one for this boot so the
    // assertion fails in CI if `dotenv:` goes back to `NODE_ENV !== "test"` —
    // that check is true the moment this test deletes NODE_ENV (#1154).
    const envPath = path.resolve(".env");
    const previous = fs.existsSync(envPath) ? fs.readFileSync(envPath, "utf8") : null;
    const planted =
      previous == null
        ? "NODE_ENV=development\n"
        : /^\s*NODE_ENV\s*=/m.test(previous)
          ? previous
          : `${previous.replace(/\n?$/, "\n")}NODE_ENV=development\n`;
    fs.writeFileSync(envPath, planted);
    try {
      expect(await patIsAdmin(undefined, "env-unset")).toBe(false);
    } finally {
      if (previous == null) fs.rmSync(envPath, { force: true });
      else fs.writeFileSync(envPath, previous);
    }
  });

  it("a PAT is admin only when NODE_ENV is explicitly development", async () => {
    expect(await patIsAdmin("development", "env-dev")).toBe(true);
  });
});

afterAll(async () => {
  await closeDb();
});
