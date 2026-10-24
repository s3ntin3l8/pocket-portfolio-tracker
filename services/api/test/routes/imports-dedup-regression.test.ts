import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { generateKeyPair, SignJWT } from "jose";
import { eq } from "drizzle-orm";
import { screenshotImports, transactions, transactionSources, portfolios } from "@portfolio/db";
import { buildApp } from "../../src/app.js";
import { getDb, closeDb } from "../../src/db/client.js";
import type { ParsedTransaction } from "@portfolio/schema";

/**
 * Regression tests for the import / dedup / reconciliation pipeline.
 *
 * Each test pins one economic guarantee that the audit found broken:
 *
 *  - a PDF import is classified against a *transaction source*, not against a parser tag
 *    (the double-conversion that made a PDF re-import "enrich" and double its tax);
 *  - only rows a derivation can see (status normal/cash_neutral) count as "already
 *    imported" — an unconfirmed or archived row must never block or absorb an import;
 *  - the 409 identifies the duplicate by a stable identity and an index into the array
 *    the client actually submitted;
 *  - a duplicate is resolvable per row (skip / import / enrich), not only in bulk;
 *  - the cash-outside gate applies to every importer, at write time, and never drops a
 *    cash-instrument purchase.
 *
 * The "already imported" side of every fixture is produced by a real confirm, so the
 * instrument identity is resolved exactly the way the import path resolves it.
 */

const ISSUER = "https://auth.test/o/p/";
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

/** The one trade every test in this file is about. */
const TRADE: ParsedTransaction = {
  assetClass: "equity",
  action: "buy",
  isin: "US0231351067",
  name: "Amazon",
  quantity: "5",
  unit: "shares",
  price: "81.37",
  fees: "0",
  currency: "EUR",
  executedAt: new Date("2026-06-15T00:00:00.000Z"),
  confidence: 1,
};

/** The same trade, carrying the tax detail a settlement PDF adds. */
const TRADE_WITH_TAX: ParsedTransaction = {
  ...TRADE,
  tax: "1.50",
  taxComponents: { kapitalertragsteuer: "1.50" },
};

async function makePortfolio(t: string, opts?: { cashCounted?: boolean }) {
  const res = await app.inject({
    method: "POST",
    url: "/portfolios",
    headers: auth(t),
    payload: {
      name: "P",
      baseCurrency: "EUR",
      ...(opts?.cashCounted === undefined ? {} : { cashCounted: opts.cashCounted }),
    },
  });
  expect(res.statusCode).toBe(201);
  return res.json().id as string;
}

/** The owner of a portfolio — the import's userId. */
async function userIdFor(portfolioId: string) {
  const [row] = await getDb()
    .select({ userId: portfolios.userId })
    .from(portfolios)
    .where(eq(portfolios.id, portfolioId));
  return row.userId;
}

/** Stage a draft import directly, so the parser tag is exactly what the test needs. */
async function stageImport(opts: {
  userId: string;
  portfolioId: string;
  parser: string;
  drafts: ParsedTransaction[];
}) {
  const [imp] = await getDb()
    .insert(screenshotImports)
    .values({
      userId: opts.userId,
      portfolioId: opts.portfolioId,
      parser: opts.parser,
      parsedJson: { drafts: opts.drafts, errors: [] },
      status: "draft",
    })
    .returning();
  return imp.id;
}

async function confirmImport(opts: {
  t: string;
  importId: string;
  portfolioId: string;
  transactions: ParsedTransaction[];
  resolutions?: Array<{ draftIndex: number; action: "skip" | "import" | "enrich" }>;
  acknowledgeDuplicates?: boolean;
}) {
  return app.inject({
    method: "POST",
    url: `/imports/${opts.importId}/confirm`,
    headers: auth(opts.t),
    payload: {
      portfolioId: opts.portfolioId,
      transactions: opts.transactions,
      ...(opts.resolutions ? { resolutions: opts.resolutions } : {}),
      ...(opts.acknowledgeDuplicates ? { acknowledgeDuplicates: true } : {}),
    },
  });
}

/**
 * Commit the trade through a real import, so the instrument is resolved exactly the way
 * the import path resolves it (both imports must land on the same instrument for the
 * fingerprint to match).
 */
async function commitTrade(opts: {
  t: string;
  userId: string;
  portfolioId: string;
  draft?: ParsedTransaction;
  parser?: string;
}) {
  const draft = opts.draft ?? TRADE;
  const importId = await stageImport({
    userId: opts.userId,
    portfolioId: opts.portfolioId,
    parser: opts.parser ?? "dkb-pdf",
    drafts: [draft],
  });
  const res = await confirmImport({
    t: opts.t,
    importId,
    portfolioId: opts.portfolioId,
    transactions: [draft],
  });
  expect(res.statusCode).toBe(201);
  const [row] = await getDb()
    .select()
    .from(transactions)
    .where(eq(transactions.portfolioId, opts.portfolioId));
  return row;
}

async function txById(id: string) {
  const [row] = await getDb().select().from(transactions).where(eq(transactions.id, id));
  return row;
}

async function sourceRows(transactionId: string) {
  return getDb()
    .select()
    .from(transactionSources)
    .where(eq(transactionSources.transactionId, transactionId));
}

async function rowsIn(portfolioId: string) {
  return getDb().select().from(transactions).where(eq(transactions.portfolioId, portfolioId));
}

describe("import dedup regressions", () => {
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

  beforeEach(async () => {
    // The dedup candidate set is per portfolio, but the instrument rows are shared —
    // wipe the transactions between tests so each one starts from a clean slate.
    await getDb().delete(transactions);
    await getDb().delete(screenshotImports);
  });

  it("pdf import vs a committed screenshot row → enrichment, not a duplicate (C1)", async () => {
    const t = await token("reg-pdf-screenshot");
    const pid = await makePortfolio(t);
    const uid = await userIdFor(pid);
    const committed = await commitTrade({ t, userId: uid, portfolioId: pid });

    // Simulate the "already imported" side being a screenshot row (a vision import of the
    // same trade) — the instrument identity is unchanged, only the source differs.
    await getDb()
      .update(transactions)
      .set({ source: "screenshot" })
      .where(eq(transactions.id, committed.id));
    await getDb()
      .update(transactionSources)
      .set({ sourceType: "screenshot" })
      .where(eq(transactionSources.transactionId, committed.id));

    const importId = await stageImport({
      userId: uid,
      portfolioId: pid,
      parser: "dkb-pdf",
      drafts: [TRADE_WITH_TAX],
    });
    const res = await confirmImport({
      t,
      importId,
      portfolioId: pid,
      transactions: [TRADE_WITH_TAX],
    });

    // A PDF is richer than a screenshot → enrichment, applied without blocking.
    expect(res.statusCode).toBe(201);
    expect(res.json().confirmed).toBe(0);
    expect(res.json().enriched).toBe(1);

    // No second transaction row was written for the same trade.
    expect(await rowsIn(pid)).toHaveLength(1);

    // The PDF's tax was folded into the existing row (and the source evidence recorded).
    const after = await txById(committed.id);
    expect(after.tax).toBe("1.50");
    const sources = await sourceRows(committed.id);
    expect(sources).toHaveLength(2);
    expect(sources.map((s) => s.sourceType).sort()).toEqual(["pdf", "screenshot"]);
  });

  it("pdf import vs a committed pdf row → 409 duplicate, and the tax is NOT doubled (C1)", async () => {
    const t = await token("reg-pdf-pdf");
    const pid = await makePortfolio(t);
    const uid = await userIdFor(pid);
    const committed = await commitTrade({
      t,
      userId: uid,
      portfolioId: pid,
      draft: { ...TRADE_WITH_TAX, externalId: "pdf:first" },
    });
    expect(committed.tax).toBe("1.50");

    const second = { ...TRADE_WITH_TAX, externalId: "pdf:second" };
    const importId = await stageImport({
      userId: uid,
      portfolioId: pid,
      parser: "dkb-pdf",
      drafts: [second],
    });
    const res = await confirmImport({
      t,
      importId,
      portfolioId: pid,
      transactions: [second],
    });

    // Same source → duplicate → the user decides. (Before the fix this was classified as
    // an enrichment: the import was swallowed and the tax was summed twice.)
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe("duplicate_transactions");
    expect(res.json().count).toBe(1);
    expect(res.json().duplicates[0].matchedSource).toBe("pdf");
    expect(res.json().duplicates[0].externalId).toBe("pdf:second");

    expect(await rowsIn(pid)).toHaveLength(1);
    const after = await txById(committed.id);
    expect(after.tax).toBe("1.50"); // not 3.00
  });

  it("pdf re-import with the same externalId → idempotent, tax unchanged", async () => {
    const t = await token("reg-pdf-same-ext");
    const pid = await makePortfolio(t);
    const uid = await userIdFor(pid);
    const committed = await commitTrade({
      t,
      userId: uid,
      portfolioId: pid,
      draft: { ...TRADE_WITH_TAX, externalId: "pdf:same" },
    });

    const same = { ...TRADE_WITH_TAX, externalId: "pdf:same" };
    const importId = await stageImport({
      userId: uid,
      portfolioId: pid,
      parser: "dkb-pdf",
      drafts: [same],
    });
    const res = await confirmImport({ t, importId, portfolioId: pid, transactions: [same] });

    // The very same record re-imported is not a *duplicate* — the unique index skips it.
    expect(res.statusCode).toBe(201);
    expect(res.json().confirmed).toBe(0);
    expect(res.json().skipped).toBe(1);

    expect(await rowsIn(pid)).toHaveLength(1);
    const after = await txById(committed.id);
    expect(after.tax).toBe("1.50");
  });

  it("a pending (unconfirmed) row blocks the import and is never enriched (C2)", async () => {
    const t = await token("reg-pending");
    const pid = await makePortfolio(t);
    const uid = await userIdFor(pid);
    const committed = await commitTrade({ t, userId: uid, portfolioId: pid });
    await getDb()
      .update(transactions)
      .set({ status: "draft" })
      .where(eq(transactions.id, committed.id));

    const importId = await stageImport({
      userId: uid,
      portfolioId: pid,
      parser: "dkb-pdf",
      drafts: [TRADE_WITH_TAX],
    });
    const res = await confirmImport({
      t,
      importId,
      portfolioId: pid,
      transactions: [TRADE_WITH_TAX],
    });

    // A pending row is invisible to every derivation, so it must not count as "already
    // imported" — but it must not be enriched either: the import would be swallowed into
    // a row the user may still discard.
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe("duplicate_transactions");
    expect(res.json().duplicates[0].pending).toBe(true);

    expect(await rowsIn(pid)).toHaveLength(1);
    const after = await txById(committed.id);
    expect(after.tax).toBeNull(); // untouched
    expect(await sourceRows(committed.id)).toHaveLength(1);
  });

  it("the blanket acknowledgement does NOT clear a pending duplicate", async () => {
    const t = await token("reg-pending-ack");
    const pid = await makePortfolio(t);
    const uid = await userIdFor(pid);
    const committed = await commitTrade({ t, userId: uid, portfolioId: pid });
    await getDb()
      .update(transactions)
      .set({ status: "draft" })
      .where(eq(transactions.id, committed.id));

    const importId = await stageImport({
      userId: uid,
      portfolioId: pid,
      parser: "dkb-pdf",
      drafts: [TRADE_WITH_TAX],
    });
    const res = await confirmImport({
      t,
      importId,
      portfolioId: pid,
      transactions: [TRADE_WITH_TAX],
      acknowledgeDuplicates: true,
    });

    // The blanket flag is for *confirmed* duplicates. An unconfirmed row always needs an
    // explicit per-row decision.
    expect(res.statusCode).toBe(409);
    expect(res.json().duplicates[0].pending).toBe(true);
  });

  it("an archived row does not swallow the import (C2)", async () => {
    const t = await token("reg-archived");
    const pid = await makePortfolio(t);
    const uid = await userIdFor(pid);
    const committed = await commitTrade({ t, userId: uid, portfolioId: pid });
    await getDb()
      .update(transactions)
      .set({ status: "archived" })
      .where(eq(transactions.id, committed.id));

    const importId = await stageImport({
      userId: uid,
      portfolioId: pid,
      parser: "dkb-pdf",
      drafts: [TRADE_WITH_TAX],
    });
    const res = await confirmImport({
      t,
      importId,
      portfolioId: pid,
      transactions: [TRADE_WITH_TAX],
    });

    // Archiving is a derivation/display exclusion, not a "this trade exists" marker: the
    // re-import has to work.
    expect(res.statusCode).toBe(201);
    expect(res.json().confirmed).toBe(1);
    expect(await rowsIn(pid)).toHaveLength(2);
  });

  it("the 409 identifies the duplicate by identity, and the index matches the submitted array (C3)", async () => {
    const t = await token("reg-index-space");
    const pid = await makePortfolio(t, { cashCounted: false });
    const uid = await userIdFor(pid);
    await commitTrade({ t, userId: uid, portfolioId: pid });

    // A cash movement *before* the duplicate — the cash-outside gate must not shift the
    // indices the client resolves against.
    const cashDraft: ParsedTransaction = {
      action: "deposit",
      isin: null,
      name: "Deposit",
      quantity: "0",
      unit: "shares",
      price: "500",
      fees: "0",
      currency: "EUR",
      executedAt: new Date("2026-06-14T00:00:00.000Z"),
      confidence: 1,
      externalId: "trpdf-deposit",
    };
    const buy = { ...TRADE_WITH_TAX, externalId: "trpdf-buy" };

    const importId = await stageImport({
      userId: uid,
      portfolioId: pid,
      parser: "tr-pdf",
      drafts: [cashDraft, buy],
    });
    const res = await confirmImport({
      t,
      importId,
      portfolioId: pid,
      transactions: [cashDraft, buy],
    });

    expect(res.statusCode).toBe(409);
    const dup = res.json().duplicates[0];
    // The duplicate is the *second* draft — index 1, and identified by its externalId.
    expect(dup.draftIndex).toBe(1);
    expect(dup.externalId).toBe("trpdf-buy");
    expect(dup.pending).toBe(false);
  });

  it("a per-row 'skip' resolution drops just that duplicate", async () => {
    const t = await token("reg-skip");
    const pid = await makePortfolio(t);
    const uid = await userIdFor(pid);
    await commitTrade({
      t,
      userId: uid,
      portfolioId: pid,
      draft: { ...TRADE_WITH_TAX, externalId: "pdf:x" },
    });

    const other: ParsedTransaction = {
      ...TRADE,
      isin: "DE0007236101",
      name: "Siemens",
      quantity: "10",
      price: "100",
      externalId: "pdf:other",
    };
    const dup = { ...TRADE_WITH_TAX, externalId: "pdf:x" };

    const importId = await stageImport({
      userId: uid,
      portfolioId: pid,
      parser: "dkb-pdf",
      drafts: [dup, other],
    });
    const res = await confirmImport({
      t,
      importId,
      portfolioId: pid,
      transactions: [dup, other],
      resolutions: [{ draftIndex: 0, action: "skip" }],
    });

    // The duplicate is skipped; the other draft is written.
    expect(res.statusCode).toBe(201);
    expect(res.json().confirmed).toBe(1);
    const rows = await rowsIn(pid);
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.externalId).sort()).toEqual(["pdf:other", "pdf:x"]);
  });

  it("a per-row 'skip' resolution targets the draft at that index, not the first", async () => {
    // The duplicate sits in the middle of the submitted array: a resolution that landed on
    // the wrong index would drop a *good* trade instead of the duplicate.
    const t = await token("reg-skip-middle");
    const pid = await makePortfolio(t);
    const uid = await userIdFor(pid);
    await commitTrade({
      t,
      userId: uid,
      portfolioId: pid,
      draft: { ...TRADE_WITH_TAX, externalId: "pdf:x" },
    });

    const first: ParsedTransaction = {
      ...TRADE,
      isin: "DE0007236101",
      name: "Siemens",
      quantity: "10",
      price: "100",
      externalId: "pdf:first",
    };
    const dup = { ...TRADE_WITH_TAX, externalId: "pdf:x" };
    const last: ParsedTransaction = {
      ...TRADE,
      isin: "FR0000120271",
      name: "Total",
      quantity: "7",
      price: "50",
      externalId: "pdf:last",
    };

    const importId = await stageImport({
      userId: uid,
      portfolioId: pid,
      parser: "dkb-pdf",
      drafts: [first, dup, last],
    });
    const res = await confirmImport({
      t,
      importId,
      portfolioId: pid,
      transactions: [first, dup, last],
      resolutions: [{ draftIndex: 1, action: "skip" }],
    });

    expect(res.statusCode).toBe(201);
    // The duplicate is skipped and the two good drafts are written.
    expect(res.json().confirmed).toBe(2);
    const rows = await rowsIn(pid);
    expect(rows).toHaveLength(3);
    expect(rows.map((r) => r.externalId).sort()).toEqual(["pdf:first", "pdf:last", "pdf:x"]);
  });

  it("a per-row 'import' resolution writes the duplicate as its own transaction", async () => {
    const t = await token("reg-import");
    const pid = await makePortfolio(t);
    const uid = await userIdFor(pid);
    await commitTrade({
      t,
      userId: uid,
      portfolioId: pid,
      draft: { ...TRADE_WITH_TAX, externalId: "pdf:x" },
    });

    const dup = { ...TRADE_WITH_TAX, externalId: "pdf:x2" };
    const importId = await stageImport({
      userId: uid,
      portfolioId: pid,
      parser: "dkb-pdf",
      drafts: [dup],
    });
    const res = await confirmImport({
      t,
      importId,
      portfolioId: pid,
      transactions: [dup],
      resolutions: [{ draftIndex: 0, action: "import" }],
    });

    expect(res.statusCode).toBe(201);
    expect(res.json().confirmed).toBe(1);
    expect(await rowsIn(pid)).toHaveLength(2);
  });

  it("a per-row 'enrich' resolution folds the draft into the matched transaction", async () => {
    const t = await token("reg-enrich");
    const pid = await makePortfolio(t);
    const uid = await userIdFor(pid);
    const committed = await commitTrade({
      t,
      userId: uid,
      portfolioId: pid,
      draft: { ...TRADE, externalId: "csv:x" },
    });
    // The committed side is a plain CSV row (no tax detail of its own).
    await getDb()
      .update(transactions)
      .set({ source: "csv" })
      .where(eq(transactions.id, committed.id));
    await getDb()
      .update(transactionSources)
      .set({ sourceType: "csv" })
      .where(eq(transactionSources.transactionId, committed.id));

    const dup = { ...TRADE_WITH_TAX, externalId: "pdf:x" };
    const importId = await stageImport({
      userId: uid,
      portfolioId: pid,
      parser: "dkb-pdf",
      drafts: [dup],
    });
    const res = await confirmImport({
      t,
      importId,
      portfolioId: pid,
      transactions: [dup],
      resolutions: [{ draftIndex: 0, action: "enrich" }],
    });

    expect(res.statusCode).toBe(201);
    expect(res.json().confirmed).toBe(0);
    expect(await rowsIn(pid)).toHaveLength(1);
    const after = await txById(committed.id);
    expect(after.tax).toBe("1.50");
  });

  it("cash movements are imported for every importer, whatever the boundary is", async () => {
    const t = await token("reg-cash-gate");
    const pid = await makePortfolio(t, { cashCounted: false });
    const uid = await userIdFor(pid);

    const deposit: ParsedTransaction = {
      action: "deposit",
      isin: null,
      name: "Deposit",
      quantity: "0",
      unit: "shares",
      price: "500",
      fees: "0",
      currency: "EUR",
      executedAt: new Date("2026-06-14T00:00:00.000Z"),
      confidence: 1,
      externalId: "csv-deposit",
    };
    const withdrawal: ParsedTransaction = {
      ...deposit,
      action: "withdrawal",
      externalId: "csv-wd",
    };
    // A cash *instrument* purchase is a security, never a cash movement.
    const moneyMarket: ParsedTransaction = {
      ...TRADE,
      assetClass: "mutual_fund",
      name: "Money Market",
      externalId: "csv-mm",
    };

    const importId = await stageImport({
      userId: uid,
      portfolioId: pid,
      parser: "csv",
      drafts: [deposit, withdrawal, moneyMarket],
    });
    const res = await confirmImport({
      t,
      importId,
      portfolioId: pid,
      transactions: [deposit, withdrawal, moneyMarket],
    });

    expect(res.statusCode).toBe(201);
    // The deposit and the withdrawal are imported like every other row: the boundary
    // decides what is *counted* and *shown*, not what is stored.
    expect(res.json().confirmed).toBe(3);

    const rows = await rowsIn(pid);
    expect(rows).toHaveLength(3);
    expect(rows.map((r) => r.type).sort()).toEqual(["buy", "deposit", "withdrawal"]);
  });

  it("the confirm response no longer carries the excluded-cash count", async () => {
    const t = await token("reg-no-excluded-count");
    const pid = await makePortfolio(t);
    const uid = await userIdFor(pid);

    const deposit: ParsedTransaction = {
      action: "deposit",
      isin: null,
      name: "Deposit",
      quantity: "0",
      unit: "shares",
      price: "500",
      fees: "0",
      currency: "EUR",
      executedAt: new Date("2026-06-14T00:00:00.000Z"),
      confidence: 1,
      externalId: "csv-deposit",
    };
    const importId = await stageImport({
      userId: uid,
      portfolioId: pid,
      parser: "csv",
      drafts: [deposit],
    });
    const res = await confirmImport({ t, importId, portfolioId: pid, transactions: [deposit] });

    expect(res.statusCode).toBe(201);
    // The field could never be non-zero any more, so it is gone rather than always 0.
    expect(res.json()).not.toHaveProperty("excludedCashMovements");
    expect(res.json()).not.toHaveProperty("cashMovementsExcluded");
  });

  it("a cash-inclusive portfolio keeps the cash movements too", async () => {
    const t = await token("reg-cash-inside");
    const pid = await makePortfolio(t, { cashCounted: true });
    const uid = await userIdFor(pid);

    const deposit: ParsedTransaction = {
      action: "deposit",
      isin: null,
      name: "Deposit",
      quantity: "0",
      unit: "shares",
      price: "500",
      fees: "0",
      currency: "EUR",
      executedAt: new Date("2026-06-14T00:00:00.000Z"),
      confidence: 1,
      externalId: "csv-deposit",
    };

    const importId = await stageImport({
      userId: uid,
      portfolioId: pid,
      parser: "csv",
      drafts: [deposit],
    });
    const res = await confirmImport({ t, importId, portfolioId: pid, transactions: [deposit] });

    expect(res.statusCode).toBe(201);
    expect(res.json().confirmed).toBe(1);
  });
});
