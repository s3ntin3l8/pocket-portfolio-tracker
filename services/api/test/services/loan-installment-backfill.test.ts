/**
 * The migration that added `transactions.installment_n` backfills it from the rules the
 * booking job used before (job rows by externalId; everything else against the earliest
 * schedule rows no repayment covers). Run its real SQL against pre-migration-shaped rows.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { eq, sql } from "drizzle-orm";
import { instruments, loans, portfolios, transactions, users } from "@portfolio/db";
import { ensureDb, closeDb } from "../../src/db/client.js";
import type { DB } from "../../src/db/client.js";

const DRIZZLE_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../../../packages/db/drizzle",
);

/** The hand-written backfill statements of the migration that introduced the column. */
function backfillStatements(): string[] {
  const file = readdirSync(DRIZZLE_DIR)
    .filter((f) => f.endsWith(".sql"))
    .find((f) => readFileSync(join(DRIZZLE_DIR, f), "utf8").includes("Backfill the explicit"));
  if (!file) throw new Error("installment_n backfill migration not found");
  return readFileSync(join(DRIZZLE_DIR, file), "utf8")
    .split("--> statement-breakpoint")
    .map((s) => s.trim())
    .filter((s) => /^(--[^\n]*\n)*\s*(UPDATE|WITH)\b/i.test(s));
}

const SCHEDULE = [1, 2, 3, 4].map((n) => ({
  n,
  dueDate: `2026-0${n}-10`,
  pokok: "1000",
  sewaModal: "0",
  angsuran: "1000",
  sisaPokok: "0",
}));

describe("installment_n backfill migration", () => {
  let db: DB;
  let portfolioId: string;
  let loanId: string;
  let bareLoanId: string;

  beforeAll(async () => {
    db = await ensureDb();
    const [u] = await db
      .insert(users)
      .values({ authSub: "backfill-user", email: "backfill@example.com" })
      .returning();
    const [pf] = await db
      .insert(portfolios)
      .values({ userId: u.id, name: "Backfill", baseCurrency: "IDR", cashCounted: false })
      .returning();
    portfolioId = pf.id;
    const [instr] = await db
      .insert(instruments)
      .values({
        symbol: "G24:BACKFILL",
        market: "GALERI24",
        assetClass: "gold",
        currency: "IDR",
        name: "LM",
      })
      .returning();
    const mk = async (contractNo: string, schedule: unknown) =>
      (
        await db
          .insert(loans)
          .values({
            portfolioId,
            instrumentId: instr.id,
            contractNo,
            provider: "GALERI24",
            purchasePrice: "4000",
            principal: "4000",
            tenorMonths: 4,
            startDate: "2025-12-01",
            schedule,
            currency: "IDR",
          })
          .returning()
      )[0]!.id;
    loanId = await mk("BF-1", SCHEDULE);
    bareLoanId = await mk("BF-2", null);

    const repay = (externalId: string, executedAt: string, id: string) => ({
      portfolioId,
      instrumentId: null,
      type: "loan_repayment" as const,
      quantity: "0",
      price: "1000",
      fees: "0",
      currency: "IDR",
      executedAt: new Date(executedAt),
      source: "manual" as const,
      loanId: id,
      externalId,
    });
    await db.insert(transactions).values([
      // Booked by the job, before the column existed: installment 2.
      repay(`loan:${loanId}:inst:2`, "2026-02-10T00:00:00Z", loanId),
      // Booked by the import, in execution order (the later one is inserted first).
      repay("import:x:loan:0:3", "2026-03-10T00:00:00Z", loanId),
      repay("import:x:loan:0:2", "2026-01-10T00:00:00Z", loanId),
      // A repayment on a loan with no schedule: nothing to map it to.
      repay("manual-bare", "2026-01-10T00:00:00Z", bareLoanId),
    ]);
  });

  afterAll(async () => {
    await closeDb();
  });

  const mapping = async (id: string) =>
    Object.fromEntries(
      (await db.select().from(transactions).where(eq(transactions.loanId, id))).map((t) => [
        t.externalId,
        t.installmentN,
      ]),
    );

  it("names job-booked rows by externalId and numbers the rest against the uncovered rows", async () => {
    for (const stmt of backfillStatements()) await db.execute(sql.raw(stmt));
    expect(await mapping(loanId)).toEqual({
      [`loan:${loanId}:inst:2`]: 2,
      // 2 is taken, so the import's two repayments take the earliest free ones, oldest first.
      "import:x:loan:0:2": 1,
      "import:x:loan:0:3": 3,
    });
    expect(await mapping(bareLoanId)).toEqual({ "manual-bare": null });
  });

  it("is a no-op when run again", async () => {
    const before = await mapping(loanId);
    for (const stmt of backfillStatements()) await db.execute(sql.raw(stmt));
    expect(await mapping(loanId)).toEqual(before);
  });
});
