import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { generateKeyPair, SignJWT } from "jose";
import { eq } from "drizzle-orm";
import { screenshotImports, portfolios, users } from "@portfolio/db";
import { buildApp } from "../../src/app.js";
import { getDb, closeDb } from "../../src/db/client.js";
import {
  bumpImportListVersion,
  importListKey,
  userScopedKey,
} from "../../src/lib/derivation-cache.js";
import { createStore, withDerivationCache } from "../../src/lib/derivation-cache.js";

const ISSUER = "https://auth.test/o/p/";
const AUDIENCE = "portfolio-tracker";

type App = Awaited<ReturnType<typeof buildApp>>;
let app: App;
let privateKey: CryptoKey;
let userASub: string;
let userBSub: string;
let userAId: string;
let userBId: string;
let userAToken: string;
let userBToken: string;

async function tokenFor(sub: string) {
  return new SignJWT({ email: `${sub}@example.com` })
    .setProtectedHeader({ alg: "ES256" })
    .setSubject(sub)
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setIssuedAt()
    .setExpirationTime("1h")
    .sign(privateKey);
}

const auth = (t: string) => ({ authorization: `Bearer ${t}` });

beforeAll(async () => {
  const kp = await generateKeyPair("ES256");
  privateKey = kp.privateKey;
  process.env.AUTHENTIK_ISSUER = ISSUER;
  process.env.AUTHENTIK_AUDIENCE = AUDIENCE;
  app = await buildApp({ authKey: kp.publicKey });
  userASub = "user-a-cache-scoping";
  userBSub = "user-b-cache-scoping";
  userAToken = await tokenFor(userASub);
  userBToken = await tokenFor(userBSub);

  // Real users (UUID PK) so child rows can reference them. The auth plugin upserts on
  // request, but pre-seeding keeps the test deterministic and the cleanup below fast.
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
  // Wipe rows the test owns so beforeEach can re-seed without unique-constraint noise.
  const db = await getDb();
  await db.delete(screenshotImports).where(eq(screenshotImports.userId, userAId));
  await db.delete(screenshotImports).where(eq(screenshotImports.userId, userBId));
  await db.delete(portfolios).where(eq(portfolios.userId, userAId));
  await db.delete(portfolios).where(eq(portfolios.userId, userBId));
});

describe("userScopedKey", () => {
  it("encodes the userId so two users with the same logical key do not collide", () => {
    const a = userScopedKey("importDetail", "user-a", "imp-1");
    const b = userScopedKey("importDetail", "user-b", "imp-1");
    expect(a).not.toBe(b);
    expect(a).toContain("user-a");
    expect(b).toContain("user-b");
  });

  it("returns a deterministic key for the same inputs", () => {
    const a = userScopedKey("importDetail", "user-a", "imp-1");
    const b = userScopedKey("importDetail", "user-a", "imp-1");
    expect(a).toBe(b);
  });
});

describe("bumpImportListVersion", () => {
  it("invalidates the per-user list cache without touching another user's cache", async () => {
    const store = createStore<number>();
    // Use importListKey() so the version stamp is part of the resolved key — that's the
    // exact helper the route uses, so the test exercises the same code path the route does.
    const aBefore = await withDerivationCache(store, importListKey("user-a"), async () => 1);
    const bBefore = await withDerivationCache(store, importListKey("user-b"), async () => 2);
    expect(aBefore).toBe(1);
    expect(bBefore).toBe(2);

    // Simulate a confirm/discard/undo for user-a only.
    bumpImportListVersion("user-a");

    // User-a's cache key now resolves to a fresh miss; user-b's still hits.
    const aAfter = await withDerivationCache(store, importListKey("user-a"), async () => 11);
    const bAfter = await withDerivationCache(store, importListKey("user-b"), async () => 22);
    expect(aAfter).toBe(11);
    expect(bAfter).toBe(2);
  });
});

describe("imports route cache scoping (latent IDOR)", () => {
  it("does not let user B read user A's cached import detail", async () => {
    // buildApp already registered the imports route (which uses the derivation cache).
    const db = await getDb();
    const [holder] = await db
      .insert(portfolios)
      .values({
        userId: userAId,
        name: "A's portfolio",
        baseCurrency: "USD",
        cashCounted: true,
      })
      .returning();
    const [imp] = await db
      .insert(screenshotImports)
      .values({
        userId: userAId,
        portfolioId: holder.id,
        parser: "csv",
        status: "draft",
        parsedJson: { drafts: [{ ticker: "X", action: "buy", quantity: "1" }] },
      })
      .returning();

    // User A fetches their own import — caches the result keyed (currently) by importId.
    const aResp = await app.inject({
      method: "GET",
      url: `/imports/${imp.id}`,
      headers: auth(userAToken),
    });
    expect(aResp.statusCode).toBe(200);
    expect(aResp.json().id).toBe(imp.id);

    // User B hits the same /imports/:id — without user-scoped keys this would return A's
    // cached payload (the IDOR). With user-scoped keys it must miss the cache, re-run
    // the compute (which performs the ownership check), and return 404.
    const bResp = await app.inject({
      method: "GET",
      url: `/imports/${imp.id}`,
      headers: auth(userBToken),
    });
    expect(bResp.statusCode).toBe(404);
    expect(bResp.json().error).toBe("import_not_found");
  });
});
