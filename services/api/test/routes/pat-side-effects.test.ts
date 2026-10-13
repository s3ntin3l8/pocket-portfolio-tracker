/**
 * Audit A7 + A9: side-effecting GETs are write-scoped (or read-through only) for
 * read-scoped PATs, and free-text query params are validated before they reach
 * third-party URLs.
 */
import { describe, it, expect, beforeAll, afterAll, vi, beforeEach } from "vitest";
import { generateKeyPair, SignJWT } from "jose";
import { instruments } from "@portfolio/db";

const enqueue = vi.hoisted(() => vi.fn(async () => undefined));
vi.mock("../../src/services/scheduler.js", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  enqueueInstrumentMetadata: enqueue,
}));

import { buildApp } from "../../src/app.js";
import { closeDb } from "../../src/db/client.js";

const ISSUER = "https://auth.test/application/o/portfolio/";
const AUDIENCE = "portfolio-tracker";
type App = Awaited<ReturnType<typeof buildApp>>;
let app: App;
let privateKey: CryptoKey;

async function jwt(sub: string) {
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

async function mintPat(owner: string, scope: "read" | "write") {
  const res = await app.inject({
    method: "POST",
    url: "/me/tokens",
    headers: auth(owner),
    payload: { name: `t-${scope}`, scope },
  });
  expect(res.statusCode).toBe(201);
  return res.json().token as string;
}

describe("read-scoped PAT vs side-effecting GETs (A7)", () => {
  let owner: string;
  let readPat: string;
  let writePat: string;

  beforeAll(async () => {
    const kp = await generateKeyPair("ES256");
    privateKey = kp.privateKey;
    process.env.AUTHENTIK_ISSUER = ISSUER;
    process.env.AUTHENTIK_AUDIENCE = AUDIENCE;
    process.env.RATE_LIMIT_MAX = "10000";
    app = await buildApp({ authKey: kp.publicKey });
    owner = await jwt("pat-side-effects");
    readPat = await mintPat(owner, "read");
    writePat = await mintPat(owner, "write");

    const [inst] = await app.db
      .insert(instruments)
      .values({
        symbol: "PATSE",
        market: "IDX",
        assetClass: "equity",
        currency: "IDR",
        name: "Pat Side Effects Co",
      })
      .returning();
    const pf = await app.inject({
      method: "POST",
      url: "/portfolios",
      headers: auth(owner),
      payload: { name: "p", baseCurrency: "idr" },
    });
    await app.inject({
      method: "POST",
      url: `/portfolios/${pf.json().id}/transactions`,
      headers: auth(owner),
      payload: {
        type: "buy",
        instrumentId: inst.id,
        quantity: "1",
        price: "100",
        currency: "IDR",
        executedAt: "2025-03-01T00:00:00.000Z",
      },
    });
  }, 30_000);

  afterAll(async () => {
    await app.close();
    await closeDb();
    delete process.env.AUTHENTIK_ISSUER;
    delete process.env.AUTHENTIK_AUDIENCE;
    delete process.env.RATE_LIMIT_MAX;
  });

  beforeEach(() => enqueue.mockClear());

  it("refuses a read PAT on the mutating GETs with 403 read_only_token", async () => {
    const id = "00000000-0000-0000-0000-000000000001";
    for (const url of [`/instruments/${id}/fundamentals`, "/instruments/enrich?q=abc"]) {
      const res = await app.inject({ method: "GET", url, headers: auth(readPat) });
      expect(res.statusCode, url).toBe(403);
      expect(res.json().error).toBe("read_only_token");
    }
  });

  it("lets a write PAT and an interactive session through", async () => {
    const id = "00000000-0000-0000-0000-000000000001";
    for (const t of [writePat, owner]) {
      const res = await app.inject({
        method: "GET",
        url: `/instruments/${id}/fundamentals`,
        headers: auth(t),
      });
      expect(res.statusCode).toBe(404);
    }
  });

  it("reaches the enrich handler with a write PAT (503 while the provider is disabled)", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/instruments/enrich?q=abc",
      headers: auth(writePat),
    });
    expect(res.statusCode).toBe(503);
    expect(res.json().error).toBe("enrichment_unavailable");
  });

  it("GET /networth enqueues metadata for an interactive session but not a read PAT", async () => {
    const ro = await app.inject({ method: "GET", url: "/networth", headers: auth(readPat) });
    expect(ro.statusCode).toBe(200);
    expect(enqueue).not.toHaveBeenCalled();

    const rw = await app.inject({ method: "GET", url: "/networth", headers: auth(owner) });
    expect(rw.statusCode).toBe(200);
    expect(enqueue).toHaveBeenCalled();
  });
});

describe("query validation before provider URLs (A9)", () => {
  let t: string;
  beforeAll(async () => {
    const kp = await generateKeyPair("ES256");
    privateKey = kp.privateKey;
    process.env.AUTHENTIK_ISSUER = ISSUER;
    process.env.AUTHENTIK_AUDIENCE = AUDIENCE;
    process.env.RATE_LIMIT_MAX = "10000";
    app = await buildApp({ authKey: kp.publicKey });
    t = await jwt("validation-user");
  }, 30_000);
  afterAll(async () => {
    await app.close();
    await closeDb();
    delete process.env.AUTHENTIK_ISSUER;
    delete process.env.AUTHENTIK_AUDIENCE;
    delete process.env.RATE_LIMIT_MAX;
  });

  it.each([
    "from=EUR&to=USD&date=2025-01-01%26x%3D1",
    "from=eur&to=USD&date=2025-01-01",
    "from=EUR&to=US%26base%3DX&date=2025-01-01",
    "from=EUR&to=USD&date=yesterday",
    "from=EUR&to=USD",
  ])("GET /fx-rate?%s -> 400", async (qs) => {
    const res = await app.inject({ method: "GET", url: `/fx-rate?${qs}`, headers: auth(t) });
    expect(res.statusCode).toBe(400);
  });

  it("GET /fx-rate accepts well-formed params", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/fx-rate?from=EUR&to=USD&date=2025-01-01",
      headers: auth(t),
    });
    expect(res.statusCode).toBe(200);
  });

  it("GET /instruments/:id/history rejects an unknown range with 400", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/instruments/00000000-0000-0000-0000-000000000001/history?range=1y%26interval%3D1m",
      headers: auth(t),
    });
    expect(res.statusCode).toBe(400);
  });
});
