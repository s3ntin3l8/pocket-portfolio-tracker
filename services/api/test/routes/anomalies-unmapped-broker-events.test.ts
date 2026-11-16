import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { generateKeyPair, SignJWT } from "jose";
import { eq } from "drizzle-orm";
import { portfolios, screenshotImports } from "@portfolio/db";
import { buildApp } from "../../src/app.js";
import { getDb, closeDb } from "../../src/db/client.js";
import { clearDerivationCache } from "../../src/lib/derivation-cache.js";
import { checkAnomalyUnion } from "../../src/services/integrity/rules.js";

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

const err = (eventType: string, code = "unmapped_event_type") => ({
  severity: "attention",
  code,
  eventType,
  message: `unmapped event type: ${eventType}`,
});

type Anomaly = { code: string; meta: Record<string, unknown> };

describe("unmapped_broker_events anomaly", () => {
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

  async function mkPortfolio(t: string, name: string) {
    const res = await app.inject({
      method: "POST",
      url: "/portfolios",
      headers: auth(t),
      payload: { name, baseCurrency: "EUR" },
    });
    return res.json().id as string;
  }

  async function addImport(
    userId: string,
    portfolioId: string,
    opts: { parser?: string; status?: "draft" | "discarded"; errors: unknown[] },
  ) {
    await getDb()
      .insert(screenshotImports)
      .values({
        userId,
        portfolioId,
        parser: opts.parser ?? "pytr",
        status: opts.status ?? "draft",
        parsedJson: { transactions: [], errors: opts.errors },
      });
  }

  const get = async (t: string, url: string) =>
    (await app.inject({ method: "GET", url, headers: auth(t) })).json().anomalies as Anomaly[];

  it("reports one anomaly per event type; discarded, other-portfolio and non-pytr imports count nothing", async () => {
    const t = await token("unmapped-anomaly");
    await app.inject({ method: "GET", url: "/me", headers: auth(t) });
    const p1 = await mkPortfolio(t, "One");
    const p2 = await mkPortfolio(t, "Two");
    const [{ userId }] = await getDb()
      .select({ userId: portfolios.userId })
      .from(portfolios)
      .where(eq(portfolios.id, p1));

    // Nothing recorded yet → no anomaly.
    expect((await get(t, `/portfolios/${p1}/anomalies`)).filter(isUnmapped)).toEqual([]);

    await addImport(userId, p1, {
      errors: [
        err("FOO_EVENT"),
        err("FOO_EVENT"),
        err("BAR_EVENT"),
        { code: "other", message: "x" },
      ],
    });
    await addImport(userId, p1, { status: "discarded", errors: [err("DISCARDED_EVENT")] });
    await addImport(userId, p1, { parser: "csv", errors: [err("CSV_EVENT")] });
    await addImport(userId, p2, { errors: [err("OTHER_PORTFOLIO_EVENT")] });

    // Still the cached empty answer until the derivation cache is cleared (as a sync does).
    expect((await get(t, `/portfolios/${p1}/anomalies`)).filter(isUnmapped)).toEqual([]);
    clearDerivationCache();
    const list = (await get(t, `/portfolios/${p1}/anomalies`)).filter(isUnmapped);
    expect(list).toHaveLength(2);
    const byType = Object.fromEntries(list.map((a) => [a.meta.eventType as string, a]));
    expect(byType.FOO_EVENT!.meta).toMatchObject({ count: 2, portfolioId: p1 });
    expect(byType.BAR_EVENT!.meta).toMatchObject({ count: 1, portfolioId: p1 });

    // The aggregate is the union of both portfolios' lists, and the integrity rule agrees.
    const agg = await get(t, "/networth/anomalies");
    expect(
      agg
        .filter(isUnmapped)
        .map((a) => a.meta.eventType)
        .sort(),
    ).toEqual(["BAR_EVENT", "FOO_EVENT", "OTHER_PORTFOLIO_EVENT"]);
    const second = (await get(t, `/portfolios/${p2}/anomalies`)).filter(isUnmapped);
    const body = (anomalies: Anomaly[]) => ({ anomalies });
    const findings = checkAnomalyUnion({
      portfolios: [
        { parity: { anomalies: body(list.concat(await nonUnmapped(t, p1))) } },
        { parity: { anomalies: body(second.concat(await nonUnmapped(t, p2))) } },
      ],
      networthParity: { anomalies: body(agg) },
    } as never);
    expect(findings).toEqual([]);
  });

  it("falls back to the message for an unparseable event without an eventType", async () => {
    const t = await token("unmapped-anomaly-msg");
    await app.inject({ method: "GET", url: "/me", headers: auth(t) });
    const p = await mkPortfolio(t, "Msg");
    const [{ userId }] = await getDb()
      .select({ userId: portfolios.userId })
      .from(portfolios)
      .where(eq(portfolios.id, p));
    await addImport(userId, p, {
      errors: [{ severity: "attention", code: "unparseable_event", message: "bad payload" }],
    });
    clearDerivationCache();
    const list = (await get(t, `/portfolios/${p}/anomalies`)).filter(isUnmapped);
    expect(list).toHaveLength(1);
    expect(list[0]!.meta).toMatchObject({ eventType: "bad payload", count: 1, portfolioId: p });
  });

  async function nonUnmapped(t: string, p: string) {
    return (await get(t, `/portfolios/${p}/anomalies`)).filter((a) => !isUnmapped(a));
  }
});

function isUnmapped(a: Anomaly) {
  return a.code === "unmapped_broker_events";
}
