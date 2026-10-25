/**
 * Route tests for FLOATING-rate Indonesian retail bonds (SBR/ST):
 *  - POST /instruments accepts a per-period coupon-rate schedule and rejects a
 *    malformed one (overlaps, unsorted periods, a percent given as a fraction, a floor
 *    above an announced rate).
 *  - The schedule back-fills onto an existing bond row only while it is null — the
 *    one-way upgrade rule every other bond term follows.
 *  - PATCH /instruments/:id sets and clears the schedule and stays admin-gated.
 *  - GET /instruments and GET /instruments/:id validate the stored schedule on the way out
 *    — a malformed row degrades to "no schedule" instead of reaching the client raw.
 *  - GET /portfolios/:id/income prices each forecast coupon at the rate of the period
 *    it falls in, not at one flat rate for the whole tenor.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { generateKeyPair, SignJWT } from "jose";
import { instruments, transactions } from "@portfolio/db";
import { buildApp } from "../../src/app.js";
import { closeDb } from "../../src/db/client.js";

const ISSUER = "https://auth.test/application/o/portfolio/";
const AUDIENCE = "portfolio-tracker";
const ADMIN_GROUP = "portfolio-admins";

type App = Awaited<ReturnType<typeof buildApp>>;

let app: App;
let privateKey: CryptoKey;

async function token(sub: string, groups?: string[]) {
  return new SignJWT({ email: `${sub}@example.com`, ...(groups ? { groups } : {}) })
    .setProtectedHeader({ alg: "ES256" })
    .setSubject(sub)
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setIssuedAt()
    .setExpirationTime("1h")
    .sign(privateKey);
}
const auth = (t: string) => ({ authorization: `Bearer ${t}` });

const SCHEDULE = {
  floorRate: "0.0675",
  periods: [
    { from: "2026-01-10", to: "2026-04-10", rate: "0.0675" },
    { from: "2026-04-10", rate: "0.07" },
  ],
};

beforeAll(async () => {
  const kp = await generateKeyPair("ES256");
  privateKey = kp.privateKey;
  process.env.AUTHENTIK_ISSUER = ISSUER;
  process.env.AUTHENTIK_AUDIENCE = AUDIENCE;
  process.env.AUTHENTIK_ADMIN_GROUP = ADMIN_GROUP;
  process.env.RATE_LIMIT_MAX = "50000";
  app = await buildApp({ authKey: kp.publicKey });
}, 30_000);

afterAll(async () => {
  await app.close();
  await closeDb();
  delete process.env.AUTHENTIK_ISSUER;
  delete process.env.AUTHENTIK_AUDIENCE;
  delete process.env.AUTHENTIK_ADMIN_GROUP;
  delete process.env.RATE_LIMIT_MAX;
});

describe("POST /instruments — floating-rate coupon schedule", () => {
  it("accepts a bond with a rate schedule and no flat coupon rate", async () => {
    const t = await token("fr-user-1");
    const res = await app.inject({
      method: "POST",
      url: "/instruments",
      headers: auth(t),
      payload: {
        symbol: "SBR015T2",
        market: "IDX",
        assetClass: "bond",
        unit: "units",
        currency: "IDR",
        name: "SBR015T2",
        faceValue: "1000000",
        couponSchedule: "monthly",
        couponRateSchedule: SCHEDULE,
        maturityDate: "2028-07-10",
      },
    });
    expect(res.statusCode, res.body).toBe(201);
    const body = res.json();
    expect(body.couponRate).toBeNull();
    expect(body.couponRateSchedule.floorRate).toBe("0.0675");
    expect(body.couponRateSchedule.periods).toHaveLength(2);
    expect(body.couponRateSchedule.periods[0].from).toBe("2026-01-10");
    expect(body.couponRateSchedule.periods[1].rate).toBe("0.07");
  });

  it("rejects a rate schedule on a non-bond asset class", async () => {
    const t = await token("fr-user-2");
    const res = await app.inject({
      method: "POST",
      url: "/instruments",
      headers: auth(t),
      payload: {
        symbol: "FR-EQUITY-BOGUS",
        market: "IDX",
        assetClass: "equity",
        unit: "shares",
        currency: "IDR",
        name: "Bogus",
        couponRateSchedule: SCHEDULE,
      },
    });
    expect(res.statusCode).toBe(400);
  });

  it("rejects overlapping periods", async () => {
    const t = await token("fr-user-3");
    const res = await app.inject({
      method: "POST",
      url: "/instruments",
      headers: auth(t),
      payload: {
        symbol: "FR-OVERLAP",
        market: "IDX",
        assetClass: "bond",
        unit: "units",
        currency: "IDR",
        name: "FR-OVERLAP",
        couponRateSchedule: {
          floorRate: "0.0675",
          periods: [
            { from: "2026-01-10", to: "2026-06-10", rate: "0.0675" },
            { from: "2026-04-10", rate: "0.07" },
          ],
        },
      },
    });
    expect(res.statusCode).toBe(400);
  });

  it("rejects a period whose end is not after its start", async () => {
    const t = await token("fr-user-4");
    const res = await app.inject({
      method: "POST",
      url: "/instruments",
      headers: auth(t),
      payload: {
        symbol: "FR-BADWINDOW",
        market: "IDX",
        assetClass: "bond",
        unit: "units",
        currency: "IDR",
        name: "FR-BADWINDOW",
        couponRateSchedule: {
          floorRate: "0.0675",
          periods: [{ from: "2026-04-10", to: "2026-04-10", rate: "0.0675" }],
        },
      },
    });
    expect(res.statusCode).toBe(400);
  });

  it("rejects a floor rate above an announced rate", async () => {
    const t = await token("fr-user-5");
    const res = await app.inject({
      method: "POST",
      url: "/instruments",
      headers: auth(t),
      payload: {
        symbol: "FR-BELFLOOR",
        market: "IDX",
        assetClass: "bond",
        unit: "units",
        currency: "IDR",
        name: "FR-BELFLOOR",
        couponRateSchedule: {
          floorRate: "0.07",
          periods: [{ from: "2026-04-10", rate: "0.0675" }],
        },
      },
    });
    expect(res.statusCode).toBe(400);
  });

  it("rejects a rate given as a percent instead of a fraction", async () => {
    const t = await token("fr-user-6");
    const res = await app.inject({
      method: "POST",
      url: "/instruments",
      headers: auth(t),
      payload: {
        symbol: "FR-PERCENT",
        market: "IDX",
        assetClass: "bond",
        unit: "units",
        currency: "IDR",
        name: "FR-PERCENT",
        couponRateSchedule: {
          floorRate: "6.75",
          periods: [{ from: "2026-04-10", rate: "6.75" }],
        },
      },
    });
    expect(res.statusCode).toBe(400);
  });
});

describe("POST /instruments — the schedule follows the one-way upgrade rule", () => {
  async function createBond(sub: string, symbol: string, extra: Record<string, unknown> = {}) {
    const res = await app.inject({
      method: "POST",
      url: "/instruments",
      headers: auth(await token(sub)),
      payload: {
        symbol,
        market: "IDX",
        assetClass: "bond",
        unit: "units",
        currency: "IDR",
        name: symbol,
        ...extra,
      },
    });
    expect(res.statusCode, res.body).toBe(201);
    return res.json();
  }

  it("back-fills a null schedule onto an existing bond row", async () => {
    const created = await createBond("fr-upgrade-1", "SBR002");
    expect(created.couponRateSchedule).toBeNull();

    const again = await createBond("fr-upgrade-1", "SBR002", {
      couponRateSchedule: SCHEDULE,
    });
    expect(again.couponRateSchedule).toMatchObject({ floorRate: "0.0675" });
  });

  it("never overwrites a schedule another user already set", async () => {
    await createBond("fr-upgrade-2", "SBR003", { couponRateSchedule: SCHEDULE });

    const again = await createBond("fr-upgrade-2", "SBR003", {
      couponRateSchedule: {
        floorRate: "0.0999",
        periods: [{ from: "2026-01-10", rate: "0.0999" }],
      },
    });
    expect(again.couponRateSchedule).toMatchObject({ floorRate: "0.0675" });
  });
});

describe("PATCH /instruments/:id — floating-rate schedule, admin-gated", () => {
  async function createBond(sub: string, symbol: string) {
    const res = await app.inject({
      method: "POST",
      url: "/instruments",
      headers: auth(await token(sub)),
      payload: {
        symbol,
        market: "IDX",
        assetClass: "bond",
        unit: "units",
        currency: "IDR",
        name: symbol,
        faceValue: "1000000",
        couponSchedule: "monthly",
        maturityDate: "2028-07-10",
      },
    });
    return res.json();
  }

  it("sets the schedule for an admin and persists it", async () => {
    const created = await createBond("fr-patch-1", "SBR004");
    const res = await app.inject({
      method: "PATCH",
      url: `/instruments/${created.id}`,
      headers: auth(await token("fr-admin-1", [ADMIN_GROUP])),
      payload: { couponRateSchedule: SCHEDULE },
    });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json().couponRateSchedule).toMatchObject({ floorRate: "0.0675" });

    const reread = await app.inject({
      method: "GET",
      url: `/instruments/${created.id}`,
      headers: auth(await token("fr-patch-1")),
    });
    expect(reread.json().couponRateSchedule.periods).toHaveLength(2);
  });

  it("clears the schedule when an admin sends null", async () => {
    const created = await createBond("fr-patch-2", "SBR005");
    await app.inject({
      method: "PATCH",
      url: `/instruments/${created.id}`,
      headers: auth(await token("fr-admin-2", [ADMIN_GROUP])),
      payload: { couponRateSchedule: SCHEDULE },
    });
    const res = await app.inject({
      method: "PATCH",
      url: `/instruments/${created.id}`,
      headers: auth(await token("fr-admin-2", [ADMIN_GROUP])),
      payload: { couponRateSchedule: null },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().couponRateSchedule).toBeNull();
  });

  it("returns 403 for a non-admin", async () => {
    const created = await createBond("fr-patch-3", "SBR006");
    const res = await app.inject({
      method: "PATCH",
      url: `/instruments/${created.id}`,
      headers: auth(await token("fr-patch-3")),
      payload: { couponRateSchedule: SCHEDULE },
    });
    expect(res.statusCode).toBe(403);
  });
});

describe("GET /instruments/:id — the stored schedule is validated on the way out", () => {
  it("degrades a malformed stored schedule to no schedule instead of returning it raw", async () => {
    const t = await token("fr-read-1");
    const created = await app.inject({
      method: "POST",
      url: "/instruments",
      headers: auth(t),
      payload: {
        symbol: "FR-MALFORMED",
        market: "IDX",
        assetClass: "bond",
        unit: "units",
        currency: "IDR",
        name: "FR-MALFORMED",
        couponRateSchedule: SCHEDULE,
      },
    });
    expect(created.statusCode, created.body).toBe(201);

    // A row written straight into the DB (or by an older shape) can hold anything —
    // `coupon_rate_schedule` is untyped jsonb.
    await app.db.execute(
      `UPDATE instruments SET coupon_rate_schedule = '{"floorRate":"0.0675"}'::jsonb WHERE symbol = 'FR-MALFORMED'`,
    );

    const res = await app.inject({
      method: "GET",
      url: `/instruments/${created.json().id}`,
      headers: auth(t),
    });
    expect(res.statusCode, res.body).toBe(200);
    // The malformed schedule is dropped, not handed to the client — and the read does
    // not fail either.
    expect(res.json().couponRateSchedule).toBeNull();
  });
});

describe("GET /instruments — the list validates the schedule the same way", () => {
  it("degrades a malformed stored schedule to no schedule in both list shapes", async () => {
    const t = await token("fr-list-1");
    const created = await app.inject({
      method: "POST",
      url: "/instruments",
      headers: auth(t),
      payload: {
        symbol: "FR-MALFORMED-LIST",
        market: "IDX",
        assetClass: "bond",
        unit: "units",
        currency: "IDR",
        name: "FR-MALFORMED-LIST",
        couponRateSchedule: SCHEDULE,
      },
    });
    expect(created.statusCode, created.body).toBe(201);

    await app.db.execute(
      `UPDATE instruments SET coupon_rate_schedule = '{"floorRate":"0.0675"}'::jsonb WHERE symbol = 'FR-MALFORMED-LIST'`,
    );

    // The paginated shape...
    const paged = await app.inject({
      method: "GET",
      url: "/instruments?page=1&pageSize=100",
      headers: auth(t),
    });
    expect(paged.statusCode, paged.body).toBe(200);
    const pagedRow = paged
      .json()
      .rows.find((r: { symbol: string }) => r.symbol === "FR-MALFORMED-LIST");
    expect(pagedRow?.couponRateSchedule).toBeNull();

    // ...and the legacy bare-array shape answer the same way for the same row.
    const legacy = await app.inject({ method: "GET", url: "/instruments", headers: auth(t) });
    expect(legacy.statusCode, legacy.body).toBe(200);
    const legacyRow = legacy
      .json()
      .find((r: { symbol: string }) => r.symbol === "FR-MALFORMED-LIST");
    expect(legacyRow?.couponRateSchedule).toBeNull();
  });

  it("returns a valid schedule unchanged", async () => {
    const t = await token("fr-list-2");
    await app.inject({
      method: "POST",
      url: "/instruments",
      headers: auth(t),
      payload: {
        symbol: "FR-VALID-LIST",
        market: "IDX",
        assetClass: "bond",
        unit: "units",
        currency: "IDR",
        name: "FR-VALID-LIST",
        couponRateSchedule: SCHEDULE,
      },
    });

    const res = await app.inject({ method: "GET", url: "/instruments", headers: auth(t) });
    expect(res.statusCode, res.body).toBe(200);
    const row = res.json().find((r: { symbol: string }) => r.symbol === "FR-VALID-LIST");
    expect(row?.couponRateSchedule).toEqual(SCHEDULE);
  });
});

describe("GET /portfolios/:id/income — floating-rate forecast coupons", () => {
  let t: string;
  let pf: string;
  /** The rate period boundary, placed ~6 months out so it always splits the 12-month
   *  forecast window regardless of when the suite runs. */
  let boundary: string;

  beforeAll(async () => {
    t = await token("fr-income-user");
    await app.inject({ method: "GET", url: "/me", headers: auth(t) });
    pf = (
      await app.inject({
        method: "POST",
        url: "/portfolios",
        headers: auth(t),
        payload: { name: "SBR", baseCurrency: "IDR", cashCounted: false },
      })
    ).json().id as string;

    const now = new Date();
    boundary = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 6, 10))
      .toISOString()
      .slice(0, 10);

    const [inst] = await app.db
      .insert(instruments)
      .values({
        symbol: "SBR015T4",
        market: "IDX",
        assetClass: "bond",
        unit: "units",
        currency: "IDR",
        name: "SBR015T4",
        faceValue: "1000000",
        couponSchedule: "monthly",
        maturityDate: "2035-07-10",
        couponRateSchedule: {
          floorRate: "0.0675",
          periods: [
            { from: "2020-01-01", to: boundary, rate: "0.0675" },
            { from: boundary, rate: "0.07" },
          ],
        },
      })
      .returning();

    await app.db.insert(transactions).values({
      portfolioId: pf,
      instrumentId: inst.id,
      type: "buy",
      quantity: "1",
      price: "1000000",
      currency: "IDR",
      executedAt: new Date("2026-01-15T10:00:00.000Z"),
    });
  });

  it("prices each forecast coupon at the rate of the period it falls in", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/portfolios/${pf}/income`,
      headers: auth(t),
    });
    expect(res.statusCode, res.body).toBe(200);
    // The forecast coupons reach the client as `upcoming` rows of kind "coupon".
    const coupons = (
      res.json().upcoming as { date: string; amount: string; kind: string }[]
    ).filter((u) => u.kind === "coupon");
    expect(coupons.length).toBeGreaterThan(0);

    // Before the boundary → the first period's rate (1,000,000 × 0.0675 / 12 = 5625).
    // After it → the second period's rate (1,000,000 × 0.07 / 12 = 5833.3333333333333333).
    const before = coupons.filter((c) => c.date < boundary);
    const after = coupons.filter((c) => c.date >= boundary);
    expect(before.length).toBeGreaterThan(0);
    expect(after.length).toBeGreaterThan(0);
    for (const c of before) expect(c.amount).toBe("5625");
    for (const c of after) expect(c.amount).toBe("5833.3333333333333333");
  });
});
