import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { eq } from "drizzle-orm";
import { generateKeyPair } from "jose";
import { portfolios, users } from "@portfolio/db";
import { buildApp } from "../../src/app.js";
import { getDb, closeDb } from "../../src/db/client.js";
import { ownedPortfolio } from "../../src/lib/owned-portfolio.js";

const ISSUER = "https://auth.test/o/p/";
const AUDIENCE = "portfolio-tracker";

type App = Awaited<ReturnType<typeof buildApp>>;
let app: App;
let userASub: string;
let userBSub: string;
let userAId: string;
let userBId: string;

beforeAll(async () => {
  const kp = await generateKeyPair("ES256");
  process.env.AUTHENTIK_ISSUER = ISSUER;
  process.env.AUTHENTIK_AUDIENCE = AUDIENCE;
  app = await buildApp({ authKey: kp.publicKey });

  userASub = "owned-portfolio-user-a";
  userBSub = "owned-portfolio-user-b";
  const db = await getDb();
  const [a] = await db
    .insert(users)
    .values({ authSub: userASub, email: `${userASub}@test.local` })
    .onConflictDoNothing()
    .returning();
  const [b] = await db
    .insert(users)
    .values({ authSub: userBSub, email: `${userBSub}@test.local` })
    .onConflictDoNothing()
    .returning();
  userAId = (a ?? (await db.select().from(users).where(eq(users.authSub, userASub)).limit(1))[0])
    .id;
  userBId = (b ?? (await db.select().from(users).where(eq(users.authSub, userBSub)).limit(1))[0])
    .id;
});

afterAll(async () => {
  await app.close();
  await closeDb();
  delete process.env.AUTHENTIK_ISSUER;
  delete process.env.AUTHENTIK_AUDIENCE;
});

beforeEach(async () => {
  const db = await getDb();
  await db.delete(portfolios).where(eq(portfolios.userId, userAId));
  await db.delete(portfolios).where(eq(portfolios.userId, userBId));
});

async function makePortfolio(userId: string, name: string) {
  const db = await getDb();
  const [p] = await db
    .insert(portfolios)
    .values({ userId, name, currency: "USD", cashCounted: true })
    .returning();
  return p;
}

describe("ownedPortfolio (lib/owned-portfolio)", () => {
  it("returns the portfolio when it belongs to the caller", async () => {
    const portfolio = await makePortfolio(userAId, "A's portfolio");
    const result = await ownedPortfolio(app, userAId, portfolio.id);
    expect(result).not.toBeNull();
    expect(result?.id).toBe(portfolio.id);
  });

  it("returns null when the portfolio belongs to a different user", async () => {
    // The defense-in-depth contract: a foreign userId + a real portfolioId must NOT
    // return that portfolio. This is the exact check the reimport handlers + documents
    // list route apply before mutating/filtering by portfolioId.
    const portfolio = await makePortfolio(userAId, "A's portfolio");
    const result = await ownedPortfolio(app, userBId, portfolio.id);
    expect(result).toBeNull();
  });

  it("returns null when the portfolio id does not exist", async () => {
    const result = await ownedPortfolio(app, userAId, "00000000-0000-0000-0000-000000000000");
    expect(result).toBeNull();
  });
});
