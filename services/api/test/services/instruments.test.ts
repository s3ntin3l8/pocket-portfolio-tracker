import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq, and } from "drizzle-orm";
import { instruments, prices } from "@portfolio/db";
import { toDateKey } from "@portfolio/core";
import { ensureDb, getDb, closeDb } from "../../src/db/client.js";
import {
  findOrCreateInstrument,
  updateInstrument,
  setManualPrice,
} from "../../src/services/instruments.js";

describe("findOrCreateInstrument", () => {
  beforeAll(async () => {
    await ensureDb();
  });
  afterAll(async () => {
    await closeDb();
  });

  const base = {
    market: "XETRA",
    assetClass: "etf" as const,
    unit: "shares" as const,
    currency: "EUR",
  };

  it("creates a new instrument when none matches", async () => {
    const inst = await findOrCreateInstrument(getDb(), {
      ...base,
      symbol: "VWCE",
      name: "Vanguard FTSE All-World",
      isin: "IE00BK5BQT80",
    });
    expect(inst.symbol).toBe("VWCE");
    expect(inst.assetClass).toBe("etf");
  });

  it("upgrades an ISIN-as-symbol to the real ticker on an ISIN match", async () => {
    const isin = "LU1737652583";
    await getDb()
      .insert(instruments)
      .values({ ...base, symbol: isin, assetClass: "mutual_fund", name: isin, isin });

    const healed = await findOrCreateInstrument(getDb(), {
      ...base,
      symbol: "AEMD",
      name: "Amundi Core MSCI EM",
      isin,
    });
    expect(healed.symbol).toBe("AEMD");
    expect(healed.assetClass).toBe("etf"); // mutual_fund → etf
  });

  it("never downgrades a real ticker to an ISIN or etf to mutual_fund", async () => {
    const isin = "IE000CNSFAR2";
    await getDb()
      .insert(instruments)
      .values({ ...base, symbol: "MWOF", assetClass: "etf", name: "Amundi MSCI World", isin });

    const unchanged = await findOrCreateInstrument(getDb(), {
      ...base,
      symbol: isin, // an ISIN must not overwrite the good ticker
      assetClass: "mutual_fund", // must not overwrite etf
      name: "Amundi MSCI World",
      isin,
    });
    expect(unchanged.symbol).toBe("MWOF");
    expect(unchanged.assetClass).toBe("etf");
  });

  it("does not clobber a specific asset class with the generic equity default", async () => {
    const isin = "LU1737652237";
    await getDb()
      .insert(instruments)
      .values({ ...base, symbol: "10AH", assetClass: "etf", name: "Amundi MSCI World", isin });

    const unchanged = await findOrCreateInstrument(getDb(), {
      ...base,
      symbol: "10AH",
      assetClass: "equity",
      name: "Amundi MSCI World",
      isin,
    });
    expect(unchanged.assetClass).toBe("etf");
  });

  it("re-pins a US stock stuck on the Xetra/EUR default to US/USD", async () => {
    const isin = "US7561091049"; // Realty Income (O)
    await getDb()
      .insert(instruments)
      .values({ ...base, symbol: isin, assetClass: "equity", name: isin, isin });

    const healed = await findOrCreateInstrument(getDb(), {
      symbol: "O",
      market: "US",
      assetClass: "equity",
      unit: "shares",
      currency: "USD",
      name: "Realty Income",
      isin,
    });
    expect(healed.symbol).toBe("O");
    expect(healed.market).toBe("US");
    expect(healed.currency).toBe("USD");
  });

  it("re-pins a TR crypto holding stuck on Xetra/EUR to CRYPTO (currency kept)", async () => {
    const isin = "XF000BTC0017";
    await getDb()
      .insert(instruments)
      .values({ ...base, symbol: isin, assetClass: "equity", name: isin, isin });

    const healed = await findOrCreateInstrument(getDb(), {
      symbol: "BTC",
      market: "CRYPTO",
      assetClass: "crypto",
      unit: "shares",
      currency: "EUR",
      name: "Bitcoin",
      isin,
    });
    expect(healed.symbol).toBe("BTC");
    expect(healed.market).toBe("CRYPTO");
    expect(healed.assetClass).toBe("crypto");
    expect(healed.currency).toBe("EUR");
  });

  it("does not re-pin a real EUR fund off Xetra", async () => {
    const isin = "IE00BK5BQV03"; // a EUR UCITS fund
    await getDb()
      .insert(instruments)
      .values({ ...base, symbol: "SXR8", assetClass: "etf", name: "iShares S&P 500", isin });

    const unchanged = await findOrCreateInstrument(getDb(), {
      ...base, // still XETRA/EUR — not a pricable foreign market
      symbol: "SXR8",
      name: "iShares S&P 500",
      isin,
    });
    expect(unchanged.market).toBe("XETRA");
    expect(unchanged.currency).toBe("EUR");
  });

  it("finds an existing instrument by WKN when no ISIN is provided", async () => {
    const wkn = "A1T8FV";
    await getDb()
      .insert(instruments)
      .values({ ...base, symbol: "DPW", name: "Deutsche Post", wkn });

    const found = await findOrCreateInstrument(getDb(), {
      ...base,
      symbol: "DPW",
      name: "Deutsche Post AG",
      wkn,
    });
    expect(found.wkn).toBe(wkn);
    // Confirm no duplicate row was created.
    const rows = await getDb().select().from(instruments).where(eq(instruments.wkn, wkn));
    expect(rows).toHaveLength(1);
  });

  it("back-fills a missing WKN onto an ISIN-matched row", async () => {
    const isin = "DE0005552004";
    await getDb()
      .insert(instruments)
      .values({ ...base, symbol: "DTE", name: "Deutsche Telekom", isin });

    const healed = await findOrCreateInstrument(getDb(), {
      ...base,
      symbol: "DTE",
      name: "Deutsche Telekom AG",
      isin,
      wkn: "555200",
    });
    expect(healed.wkn).toBe("555200");
    expect(healed.isin).toBe(isin);
  });

  it("heals a row matched by (symbol, market) when no ISIN is supplied", async () => {
    await getDb()
      .insert(instruments)
      .values({ ...base, symbol: "EUNL", assetClass: "mutual_fund", name: "iShares Core World" });

    const healed = await findOrCreateInstrument(getDb(), {
      ...base,
      symbol: "EUNL",
      assetClass: "etf",
      name: "iShares Core World",
    });
    expect(healed.assetClass).toBe("etf");
    // Confirm it updated in place, not inserted a duplicate.
    const rows = await getDb().select().from(instruments).where(eq(instruments.symbol, "EUNL"));
    expect(rows).toHaveLength(1);
  });

  // --- Heal-path re-pin for unknown markets (issue #283) ---

  it("re-pins an existing row stuck on an unrecognised market when a priceable venue is resolved", async () => {
    // Simulates the legacy AMZN-on-PE case: a row was created with a raw provider exchange
    // code ("PE") instead of the canonical internal market ("US").
    const isin = "US0231351067"; // Amazon
    await getDb()
      .insert(instruments)
      .values({
        market: "PE",
        assetClass: "equity" as const,
        unit: "shares" as const,
        currency: "EUR",
        symbol: "AMZN",
        name: "Amazon",
        isin,
      });

    const healed = await findOrCreateInstrument(getDb(), {
      symbol: "AMZN",
      market: "US",
      assetClass: "equity",
      unit: "shares",
      currency: "USD",
      name: "Amazon.com Inc",
      isin,
    });
    expect(healed.market).toBe("US");
    expect(healed.currency).toBe("USD");
  });

  it("does not re-pin an unknown-market row when the input market is not priceable (XETRA fallback from failed lookup)", async () => {
    // When resolveEuIsin fails, market falls back to XETRA — we must not trade PE→XETRA.
    const isin = "US1234567890";
    await getDb()
      .insert(instruments)
      .values({
        market: "PE",
        assetClass: "equity" as const,
        unit: "shares" as const,
        currency: "EUR",
        symbol: "TSTXX",
        name: "TestCo",
        isin,
      });

    const unchanged = await findOrCreateInstrument(getDb(), {
      symbol: "TSTXX",
      market: "XETRA", // what we'd pass when OpenFIGI lookup failed
      assetClass: "equity",
      unit: "shares",
      currency: "EUR",
      name: "TestCo",
      isin,
    });
    // PE is not in PRICEABLE_FOREIGN_MARKETS and XETRA is not either → no re-pin
    expect(unchanged.market).toBe("PE");
    expect(unchanged.currency).toBe("EUR");
  });

  // --- Create-time guard via opts.resolveMarket (issue #283) ---

  it("creates the instrument with the corrected market when resolveMarket returns a known market", async () => {
    const isin = "US5949181045"; // Microsoft
    const created = await findOrCreateInstrument(
      getDb(),
      {
        symbol: "MSFT",
        market: "PE", // unrecognised raw exchange code from a hypothetical source
        assetClass: "equity",
        unit: "shares",
        currency: "EUR",
        name: "Microsoft Corporation",
        isin,
      },
      {
        resolveMarket: async () => ({ market: "US", currency: "USD" }),
      },
    );
    expect(created.market).toBe("US");
    expect(created.currency).toBe("USD");
    // Confirm only one row exists.
    const rows = await getDb().select().from(instruments).where(eq(instruments.isin, isin));
    expect(rows).toHaveLength(1);
  });

  it("keeps the import-provided market when resolveMarket returns null", async () => {
    const isin = "US9884981013"; // fictional ISIN
    const created = await findOrCreateInstrument(
      getDb(),
      {
        symbol: "ZZZZ",
        market: "PE",
        assetClass: "equity",
        unit: "shares",
        currency: "EUR",
        name: "Unknown Co",
        isin,
      },
      {
        resolveMarket: async () => null,
      },
    );
    expect(created.market).toBe("PE"); // falls back to import-provided value
  });

  it("keeps the import-provided market when resolveMarket throws", async () => {
    const isin = "US9884981014"; // fictional ISIN
    const created = await findOrCreateInstrument(
      getDb(),
      {
        symbol: "ZZZZ2",
        market: "PE",
        assetClass: "equity",
        unit: "shares",
        currency: "EUR",
        name: "Unknown Co 2",
        isin,
      },
      {
        resolveMarket: async () => {
          throw new Error("OpenFIGI rate-limited");
        },
      },
    );
    expect(created.market).toBe("PE"); // graceful fallback
  });

  // --- Bond terms (Indonesian retail SR/ORI support) ---

  const bondBase = {
    market: "IDX",
    assetClass: "bond" as const,
    unit: "units" as const,
    currency: "IDR",
  };

  it("persists bond terms on create", async () => {
    const created = await findOrCreateInstrument(getDb(), {
      ...bondBase,
      symbol: "SR021T3",
      name: "Sukuk Negara Ritel seri SR021T3",
      faceValue: "1000000",
      couponRate: "0.0635",
      couponSchedule: "monthly" as const,
      maturityDate: "2027-09-10",
    });
    expect(created.faceValue).toBe("1000000");
    expect(created.couponRate).toBe("0.0635");
    expect(created.couponSchedule).toBe("monthly");
    expect(created.maturityDate).toBe("2027-09-10");
  });

  it("backfills bond terms on an existing row whose columns are null", async () => {
    await getDb()
      .insert(instruments)
      .values({ ...bondBase, symbol: "SR022T3", name: "SR022T3" });

    const healed = await findOrCreateInstrument(getDb(), {
      ...bondBase,
      symbol: "SR022T3",
      name: "SR022T3",
      faceValue: "1000000",
      couponRate: "0.06",
      couponSchedule: "monthly" as const,
      maturityDate: "2028-01-10",
    });
    expect(healed.faceValue).toBe("1000000");
    expect(healed.couponRate).toBe("0.06");
  });

  it("does not overwrite existing non-null bond terms", async () => {
    await getDb()
      .insert(instruments)
      .values({
        ...bondBase,
        symbol: "SR023T3",
        name: "SR023T3",
        faceValue: "1000000",
        couponRate: "0.0555",
        couponSchedule: "monthly",
        maturityDate: "2028-06-10",
      });

    const unchanged = await findOrCreateInstrument(getDb(), {
      ...bondBase,
      symbol: "SR023T3",
      name: "SR023T3",
      faceValue: "9999999", // a would-be typo from a second user
      couponRate: "0.9",
    });
    expect(unchanged.faceValue).toBe("1000000");
    expect(unchanged.couponRate).toBe("0.0555");
  });

  it("does not stamp bond terms onto an existing non-bond row when a bond input collides by (symbol, market)", async () => {
    // The vulnerable path: instrumentInputSchema only ever carries bond fields when
    // input.assetClass is "bond" — so a guard written as
    // `existing.assetClass === "bond" || input.assetClass === "bond"` is always true
    // whenever there's anything to back-fill, and never actually distinguishes "an
    // unrelated equity row collided with a bond input" from "both sides are a bond".
    // This must gate on `existing.assetClass`, not `input.assetClass`.
    await getDb().insert(instruments).values({
      market: "IDX",
      assetClass: "equity",
      unit: "shares",
      currency: "IDR",
      symbol: "BBCA-ZZZ",
      name: "Bank Central Asia",
    });

    const result = await findOrCreateInstrument(getDb(), {
      symbol: "BBCA-ZZZ", // fat-fingered collision with the existing equity row
      market: "IDX",
      assetClass: "bond", // attacker/typo input IS a bond — this is the exploitable case
      unit: "units",
      currency: "IDR",
      name: "Bank Central Asia",
      faceValue: "1000000",
      couponRate: "0.05",
    });
    // The bond-terms columns must stay untouched regardless of what instrumentUpgrade's
    // separate, pre-existing asset-class-refinement rule does with `assetClass` itself
    // (that rule predates this feature and is out of scope here — see the block above
    // in instrumentUpgrade()).
    expect(result.faceValue).toBeNull();
    expect(result.couponRate).toBeNull();
  });
});

describe("updateInstrument", () => {
  beforeAll(async () => {
    await ensureDb();
  });
  afterAll(async () => {
    await closeDb();
  });

  const base = {
    market: "XETRA",
    assetClass: "equity" as const,
    unit: "shares" as const,
    currency: "EUR",
  };

  it("updates ISIN and WKN on an existing row", async () => {
    const [row] = await getDb()
      .insert(instruments)
      .values({ ...base, symbol: "ENR", name: "Siemens Energy" })
      .returning();

    const updated = await updateInstrument(getDb(), row.id, {
      isin: "DE000ENER6Y0",
      wkn: "ENER6Y",
    });
    expect(updated).not.toBe("not_found");
    expect(updated).not.toBe("conflict");
    if (typeof updated !== "string") {
      expect(updated.isin).toBe("DE000ENER6Y0");
      expect(updated.wkn).toBe("ENER6Y");
    }
  });

  it("returns conflict when ISIN already belongs to another row", async () => {
    const isin = "DE000ENRDUP0";
    await getDb()
      .insert(instruments)
      .values({ ...base, symbol: "OTHER", name: "Other Instrument", isin });
    const [row] = await getDb()
      .insert(instruments)
      .values({ ...base, symbol: "ENR2", name: "Siemens Energy 2" })
      .returning();

    const result = await updateInstrument(getDb(), row.id, { isin });
    expect(result).toBe("conflict");
  });

  it("returns not_found for an unknown id", async () => {
    const result = await updateInstrument(getDb(), "00000000-0000-0000-0000-000000000000", {
      wkn: "A1T8FV",
    });
    expect(result).toBe("not_found");
  });

  it("updates bond terms on an existing row", async () => {
    const [row] = await getDb()
      .insert(instruments)
      .values({
        market: "IDX",
        assetClass: "bond",
        unit: "units",
        currency: "IDR",
        symbol: "ORI024",
        name: "ORI024",
      })
      .returning();

    const updated = await updateInstrument(getDb(), row.id, {
      faceValue: "1000000",
      couponRate: "0.062",
      couponSchedule: "monthly",
      maturityDate: "2029-03-10",
    });
    expect(updated).not.toBe("not_found");
    expect(updated).not.toBe("conflict");
    if (typeof updated !== "string") {
      expect(updated.faceValue).toBe("1000000");
      expect(updated.couponRate).toBe("0.062");
      expect(updated.couponSchedule).toBe("monthly");
      expect(updated.maturityDate).toBe("2029-03-10");
    }
  });

  it("clears a bond term when patched with null", async () => {
    const [row] = await getDb()
      .insert(instruments)
      .values({
        market: "IDX",
        assetClass: "bond",
        unit: "units",
        currency: "IDR",
        symbol: "ORI025",
        name: "ORI025",
        faceValue: "1000000",
      })
      .returning();

    const updated = await updateInstrument(getDb(), row.id, { faceValue: null });
    expect(updated).not.toBe("not_found");
    expect(updated).not.toBe("conflict");
    if (typeof updated !== "string") {
      expect(updated.faceValue).toBeNull();
    }
  });
});

describe("setManualPrice", () => {
  beforeAll(async () => {
    await ensureDb();
  });
  afterAll(async () => {
    await closeDb();
  });

  it("sets a manual price and writes a prices row at manualPriceAt", async () => {
    const db = getDb();
    const [row] = await db
      .insert(instruments)
      .values({
        market: "IDX",
        assetClass: "bond",
        unit: "units",
        currency: "IDR",
        symbol: "SR021T3-MP",
        name: "SR021T3 manual price test",
        faceValue: "1000000",
      })
      .returning();

    const result = await setManualPrice(db, row.id, "985000");
    expect(result).not.toBe("not_found");
    if (typeof result === "string") return;

    expect(result.manualPrice).toBe("985000");
    expect(result.manualPriceAt).not.toBeNull();

    // A prices row should exist at the manualPriceAt date.
    const priceDate = toDateKey(new Date(result.manualPriceAt!));
    const [priceRow] = await db
      .select()
      .from(prices)
      .where(and(eq(prices.instrumentId, row.id), eq(prices.date, priceDate)));
    expect(priceRow).toBeDefined();
    expect(priceRow!.close).toBe("985000");
    expect(priceRow!.currency).toBe("IDR");
  });

  it("overwrites the prices row when manual price is set again on the same day", async () => {
    const db = getDb();
    const [row] = await db
      .insert(instruments)
      .values({
        market: "IDX",
        assetClass: "bond",
        unit: "units",
        currency: "IDR",
        symbol: "SR021T3-MP2",
        name: "SR021T3 manual price overwrite test",
        faceValue: "1000000",
      })
      .returning();

    await setManualPrice(db, row.id, "985000");
    const updated = await setManualPrice(db, row.id, "990000");
    expect(updated).not.toBe("not_found");
    if (typeof updated === "string") return;

    expect(updated.manualPrice).toBe("990000");

    // Same day → one prices row, updated in place via onConflictDoUpdate.
    const allPriceRows = await db
      .select()
      .from(prices)
      .where(eq(prices.instrumentId, row.id))
      .orderBy(prices.date);
    expect(allPriceRows).toHaveLength(1);
    expect(allPriceRows[0]!.close).toBe("990000");
  });

  it("clears the prices row for the old manualPriceAt when price is cleared", async () => {
    const db = getDb();
    const [row] = await db
      .insert(instruments)
      .values({
        market: "IDX",
        assetClass: "bond",
        unit: "units",
        currency: "IDR",
        symbol: "SR021T3-MP3",
        name: "SR021T3 manual price clear test",
        faceValue: "1000000",
      })
      .returning();

    const before = await setManualPrice(db, row.id, "985000");
    expect(before).not.toBe("not_found");
    if (typeof before === "string") return;
    const oldDate = toDateKey(new Date(before.manualPriceAt!));

    await setManualPrice(db, row.id, null);

    // The prices row for the old manualPriceAt date should be deleted.
    const [gone] = await db
      .select()
      .from(prices)
      .where(and(eq(prices.instrumentId, row.id), eq(prices.date, oldDate)));
    expect(gone).toBeUndefined();
  });

  it("returns not_found for unknown id", async () => {
    const result = await setManualPrice(getDb(), "00000000-0000-0000-0000-000000000000", "100");
    expect(result).toBe("not_found");
  });
});
