import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { generateKeyPair, SignJWT } from "jose";
import { buildApp } from "../../src/app.js";
import { closeDb } from "../../src/db/client.js";
import type { ParsedTransaction } from "@portfolio/schema";
import type { ScreenshotParser } from "../../src/services/parsers/types.js";

const ISSUER = "https://auth.test/application/o/portfolio/";
const AUDIENCE = "portfolio-tracker";

type App = Awaited<ReturnType<typeof buildApp>>;
let app: App;
let privateKey: CryptoKey;

async function token(sub: string) {
  return new SignJWT({ email: `${sub}@test.example` })
    .setProtectedHeader({ alg: "ES256" })
    .setSubject(sub)
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setIssuedAt()
    .setExpirationTime("1h")
    .sign(privateKey);
}

const auth = (t: string) => ({ authorization: `Bearer ${t}` });

// Cross-source race fixture: a CSV import and a screenshot import that carry
// the SAME economic BBCA trade. Pre-fix, the dedup check ran outside the
// write tx — both confirms would see "no committed row" and both would write
// the BBCA trade, manufacturing a duplicate position. Post-fix, the in-tx
// SELECT ... FOR UPDATE serialises them: the second confirm waits for the
// first's commit and returns 409 unless the caller already acknowledged.
const BBCA_TRADE = {
  assetClass: "equity" as const,
  action: "buy" as const,
  ticker: "BBCA",
  name: "Bank Central Asia",
  quantity: "100",
  unit: "shares" as const,
  price: "9500",
  fees: "0",
  currency: "IDR",
  executedAt: new Date("2026-01-15T00:00:00.000Z"),
  confidence: 0.9,
} satisfies ParsedTransaction;

const CSV_A = [
  "date,action,assetClass,name,ticker,quantity,unit,price,fees,currency",
  "2026-01-15,buy,equity,Bank Central Asia,BBCA,100,shares,9500,0,IDR",
].join("\n");

// Second screenshot import carrying the same BBCA trade — the source tag
// differs ("screenshot" vs "csv") and the content hash differs, so the
// unique index `(portfolioId, source, externalId)` does NOT catch it; only
// the cross-source dedup check does.
const SCREENSHOT_PARSER: ScreenshotParser = {
  name: "mock",
  isConfigured: () => true,
  parse: async () => ({ drafts: [BBCA_TRADE], contracts: [] }),
};

// Build a raw multipart/form-data payload that the screenshot upload route accepts.
function screenshotPart(buf: Buffer, contentType: string, filename = "upload.png") {
  const boundary = "----RaceBoundary";
  const payload = Buffer.concat([
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: ${contentType}\r\n\r\n`,
    ),
    buf,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
  return {
    headers: { "content-type": `multipart/form-data; boundary=${boundary}` },
    payload,
  };
}

describe("POST /imports/confirm — concurrent cross-source dedup (#B11)", () => {
  beforeAll(async () => {
    const kp = await generateKeyPair("ES256");
    privateKey = kp.privateKey;
    process.env.AUTHENTIK_ISSUER = ISSUER;
    process.env.AUTHENTIK_AUDIENCE = AUDIENCE;
    process.env.RATE_LIMIT_MAX = "10000";
    app = await buildApp({ authKey: kp.publicKey, screenshotParser: SCREENSHOT_PARSER });
  });

  afterAll(async () => {
    await app.close();
    await closeDb();
    delete process.env.AUTHENTIK_ISSUER;
    delete process.env.AUTHENTIK_AUDIENCE;
    delete process.env.RATE_LIMIT_MAX;
  });

  it("two concurrent confirms of cross-source duplicates → exactly one 201 + one 409 (no double-write)", async () => {
    const t = await token("race-user");
    const portfolioId = (
      await app.inject({
        method: "POST",
        url: "/portfolios",
        headers: auth(t),
        payload: { name: "Race", baseCurrency: "IDR" },
      })
    ).json().id;

    // Stage a CSV import carrying the BBCA trade.
    const rA = await app.inject({
      method: "POST",
      url: "/imports/csv",
      headers: auth(t),
      payload: { content: CSV_A },
    });
    expect(rA.statusCode).toBe(201);
    const importA = rA.json().importId as string;
    const draftsA = rA.json().drafts as ParsedTransaction[];

    // Stage a screenshot import carrying the same BBCA trade. Different
    // parser/source → different externalId → unique index does not catch it.
    const form = screenshotPart(Buffer.from("fake-png"), "image/png", "race.png");
    const rB = await app.inject({
      method: "POST",
      url: "/imports/screenshot",
      headers: { ...auth(t), ...form.headers },
      payload: form.payload,
    });
    expect(rB.statusCode).toBe(201);
    const importB = rB.json().importId as string;
    const draftsB = rB.json().drafts as ParsedTransaction[];

    // Fire both confirms at the same time. Pre-fix, both would clear the 409
    // dedup check (it ran outside the write tx) and both would write the
    // BBCA trade → two duplicate positions. Post-fix, the in-tx
    // SELECT ... FOR UPDATE on the portfolio row serialises them: the second
    // confirm waits, then sees the first's commit and returns 409.
    const [resA, resB] = await Promise.all([
      app.inject({
        method: "POST",
        url: `/imports/${importA}/confirm`,
        headers: auth(t),
        payload: { portfolioId, transactions: draftsA },
      }),
      app.inject({
        method: "POST",
        url: `/imports/${importB}/confirm`,
        headers: auth(t),
        payload: { portfolioId, transactions: draftsB },
      }),
    ]);

    const codes = [resA.statusCode, resB.statusCode].sort();
    expect(codes).toEqual([201, 409]);

    const winner = resA.statusCode === 201 ? resA : resB;
    const loser = resA.statusCode === 409 ? resA : resB;
    expect(loser.json().error).toBe("duplicate_transactions");
    expect(loser.json().count).toBe(1);
    expect(winner.json().confirmed).toBe(1);

    // Hard invariant: exactly one BBCA position with quantity 100 — never two.
    const holdings = await app.inject({
      method: "GET",
      url: `/portfolios/${portfolioId}/holdings`,
      headers: auth(t),
    });
    const hs = holdings.json().holdings as Array<{ quantity: string }>;
    expect(hs).toHaveLength(1);
    expect(Number(hs[0].quantity)).toBe(100);
  });

  it("acknowledging duplicates lets the second confirm write through; the unique index absorbs the duplicate", async () => {
    const t = await token("race-ack-user");
    const portfolioId = (
      await app.inject({
        method: "POST",
        url: "/portfolios",
        headers: auth(t),
        payload: { name: "RaceAck", baseCurrency: "IDR" },
      })
    ).json().id;

    const rA = await app.inject({
      method: "POST",
      url: "/imports/csv",
      headers: auth(t),
      payload: { content: CSV_A },
    });
    const form = screenshotPart(Buffer.from("fake-png"), "image/png", "ack.png");
    const rB = await app.inject({
      method: "POST",
      url: "/imports/screenshot",
      headers: { ...auth(t), ...form.headers },
      payload: form.payload,
    });

    // Both opt into acknowledging duplicates. The lock still serialises them;
    // the second confirm sees the first's commit and acknowledges it. The
    // BBCA externalIds differ (csv vs screenshot), so the unique index
    // allows both writes — but the cross-source dedup is now a deliberate,
    // acknowledged decision rather than an invisible double-write.
    const [resA, resB] = await Promise.all([
      app.inject({
        method: "POST",
        url: `/imports/${rA.json().importId}/confirm`,
        headers: auth(t),
        payload: {
          portfolioId,
          transactions: rA.json().drafts,
          acknowledgeDuplicates: true,
        },
      }),
      app.inject({
        method: "POST",
        url: `/imports/${rB.json().importId}/confirm`,
        headers: auth(t),
        payload: {
          portfolioId,
          transactions: rB.json().drafts,
          acknowledgeDuplicates: true,
        },
      }),
    ]);

    expect(resA.statusCode).toBe(201);
    expect(resB.statusCode).toBe(201);
  });
});
