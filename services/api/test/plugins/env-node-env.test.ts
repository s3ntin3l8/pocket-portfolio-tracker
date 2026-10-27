import { describe, it, expect, afterEach, afterAll } from "vitest";
import { users, apiTokens } from "@portfolio/db";
import { buildApp } from "../../src/app.js";
import { closeDb } from "../../src/db/client.js";
import { hashToken, PAT_PREFIX } from "../../src/plugins/auth.js";
import { shouldLoadDotenv } from "../../src/plugins/env.js";

describe("NODE_ENV default is fail-closed", () => {
  const saved = process.env.NODE_ENV;

  it("does not load a developer .env when NODE_ENV is unset under Vitest", () => {
    // The README setup (`cp .env.example .env`) puts NODE_ENV=development in that
    // file. Unset NODE_ENV must stay unset — not be filled back in from .env —
    // or the fail-closed default below is a lie on every developer machine.
    expect(shouldLoadDotenv({ ...process.env, NODE_ENV: undefined, VITEST: "true" })).toBe(false);
    expect(shouldLoadDotenv({ NODE_ENV: "test" })).toBe(false);
    expect(shouldLoadDotenv({})).toBe(true);
    expect(shouldLoadDotenv({ NODE_ENV: "development" })).toBe(true);
  });
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
    expect(await patIsAdmin(undefined, "env-unset")).toBe(false);
  });

  it("a PAT is admin only when NODE_ENV is explicitly development", async () => {
    expect(await patIsAdmin("development", "env-dev")).toBe(true);
  });
});

afterAll(async () => {
  await closeDb();
});
