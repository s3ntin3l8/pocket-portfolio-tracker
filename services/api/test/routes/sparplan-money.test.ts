import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { generateKeyPair, SignJWT } from "jose";
import { buildApp } from "../../src/app.js";
import { closeDb } from "../../src/db/client.js";

const ISSUER = "https://auth.test/application/o/portfolio/";
const AUDIENCE = "portfolio-tracker";

type App = Awaited<ReturnType<typeof buildApp>>;
let app: App;
let privateKey: CryptoKey;

async function token(sub: string) {
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

async function createPortfolio(t: string, payload: Record<string, unknown>): Promise<string> {
  const res = await app.inject({
    method: "POST",
    url: "/portfolios",
    headers: auth(t),
    payload,
  });
  expect(res.statusCode).toBe(201);
  return res.json().id as string;
}

async function createHolder(t: string, payload: Record<string, unknown>): Promise<string> {
  const res = await app.inject({
    method: "POST",
    url: "/account-holders",
    headers: auth(t),
    payload,
  });
  expect(res.statusCode).toBe(201);
  return res.json().id as string;
}

describe("sparplan/tax rollups — money-as-decimal (no float drift)", () => {
  beforeAll(async () => {
    const kp = await generateKeyPair("ES256");
    privateKey = kp.privateKey;
    process.env.AUTHENTIK_ISSUER = ISSUER;
    process.env.AUTHENTIK_AUDIENCE = AUDIENCE;
    process.env.RATE_LIMIT_MAX = "10000";
    app = await buildApp({ authKey: kp.publicKey });
  });

  afterAll(async () => {
    await app.close();
    await closeDb();
    delete process.env.AUTHENTIK_ISSUER;
    delete process.env.AUTHENTIK_AUDIENCE;
    delete process.env.RATE_LIMIT_MAX;
  });

  // Sanity check: IEEE-754 binary-float drifts. If this ever starts passing,
  // the runtime is no longer using standard JS numbers and the rest of the
  // suite's drift assertions become meaningless.
  it("[sanity] 0.1 + 0.2 ≠ 0.3 in IEEE-754 (drift baseline)", () => {
    expect(0.1 + 0.2).not.toBe(0.3);
    expect(0.1 + 0.2).toBe(0.30000000000000004);
  });

  // The plan's headline case: 999.99 + 0.01 = 1000.00 must be exact at the
  // display boundary, no drift residue. Pre-fix, `Number(p.taxAllowanceAnnual
  // ?? 0)` followed by `.toFixed(2)` happened to round "right" by luck for
  // this pair, but the underlying Number() arithmetic compounds drift as soon
  // as a third depot (or any chain of subtractions) is involved — see the
  // next test for the actual drift.
  it("display-side allowance sum uses Decimal, not float", async () => {
    const t = await token("money-decimal");
    const holderId = await createHolder(t, {
      name: "Decimal Holder",
      taxAllowanceAnnual: "1000",
    });
    await createPortfolio(t, {
      name: "Depot A",
      accountHolderId: holderId,
      taxAllowanceAnnual: "999.99",
    });
    await createPortfolio(t, {
      name: "Depot B",
      accountHolderId: holderId,
      taxAllowanceAnnual: "0.01",
    });

    const res = await app.inject({
      method: "GET",
      url: "/networth/tax?year=2025",
      headers: auth(t),
    });
    expect(res.statusCode).toBe(200);
    const [entry] = res.json() as Array<{
      distribution: {
        holderAllowanceCap: string;
        totalAllocated: string;
        remainingToDistribute: string;
        overAllocated: boolean;
      };
    }>;

    // Decimal arithmetic: 999.99 + 0.01 = 1000.00 exactly. The displayed
    // string must be exactly that, and must round-trip back to 1000.
    expect(entry.distribution.holderAllowanceCap).toBe("1000.00");
    expect(entry.distribution.totalAllocated).toBe("1000.00");
    expect(entry.distribution.remainingToDistribute).toBe("0.00");
    expect(entry.distribution.overAllocated).toBe(false);

    expect(Number(entry.distribution.totalAllocated)).toBe(1000);
    expect(Number(entry.distribution.holderAllowanceCap)).toBe(1000);
  });

  // The actual float-drift trap: 0.1 + 0.2 = 0.30000000000000004 in
  // IEEE-754. Pre-fix, `Number(p.taxAllowanceAnnual ?? 0)` sums these to
  // 0.30000000000000004; `toFixed(2)` rounds to "0.30" only by luck (the
  // residue is below the 4th dp). Post-fix, Decimal gives exactly 0.3 and
  // toFixed(2) is a pure format step.
  it("allocations summing to 0.1 + 0.2 do not surface float drift in the response", async () => {
    const t = await token("money-decimal-drift");
    const holderId = await createHolder(t, {
      name: "Drift Holder",
      taxAllowanceAnnual: "1000",
    });
    await createPortfolio(t, {
      name: "Tiny A",
      accountHolderId: holderId,
      taxAllowanceAnnual: "0.1",
    });
    await createPortfolio(t, {
      name: "Tiny B",
      accountHolderId: holderId,
      taxAllowanceAnnual: "0.2",
    });

    const res = await app.inject({
      method: "GET",
      url: "/networth/tax?year=2025",
      headers: auth(t),
    });
    expect(res.statusCode).toBe(200);
    const [entry] = res.json() as Array<{
      distribution: { totalAllocated: string; remainingToDistribute: string };
    }>;

    expect(entry.distribution.totalAllocated).toBe("0.30");
    expect(entry.distribution.remainingToDistribute).toBe("999.70");
  });

  // Per-portfolio route (#portfolio-tax): the same helper also produces the
  // holderAllocation for the single-portfolio endpoint. The drift can leak
  // here too if the upstream Number(...) reductions are used.
  it("/portfolios/:id/tax holderDistribution totalAllocated is exact Decimal", async () => {
    const t = await token("money-decimal-pf");
    const holderId = await createHolder(t, {
      name: "PF Holder",
      taxAllowanceAnnual: "1000",
    });
    const pf = await createPortfolio(t, {
      name: "PF",
      accountHolderId: holderId,
      taxAllowanceAnnual: "999.99",
    });
    await createPortfolio(t, {
      name: "Other",
      accountHolderId: holderId,
      taxAllowanceAnnual: "0.01",
    });

    const res = await app.inject({
      method: "GET",
      url: `/portfolios/${pf}/tax?year=2025`,
      headers: auth(t),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      holderDistribution: {
        holderAllowanceCap: string;
        totalAllocated: string;
        remainingToDistribute: string;
        overAllocated: boolean;
      };
    };

    expect(body.holderDistribution.holderAllowanceCap).toBe("1000.00");
    expect(body.holderDistribution.totalAllocated).toBe("1000.00");
    expect(body.holderDistribution.remainingToDistribute).toBe("0.00");
    expect(body.holderDistribution.overAllocated).toBe(false);
  });
});
