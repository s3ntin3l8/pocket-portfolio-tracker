/**
 * `bookDueInstallments`: a financed gold contract (cicilan) only books the installments
 * due at import time; this job books the rest as they fall due so the loan balance (and
 * net worth) tracks the schedule. Must be idempotent and must not double-book the rows
 * the import already wrote.
 */
import { describe, it, expect, afterAll, beforeAll } from "vitest";
import { eq } from "drizzle-orm";
import {
  instruments,
  loans,
  portfolios,
  screenshotImports,
  transactions,
  users,
} from "@portfolio/db";
import { loanBalances, type CoreTransaction } from "@portfolio/core";
import { ensureDb, closeDb } from "../../src/db/client.js";
import type { DB } from "../../src/db/client.js";
import { bookDueInstallments } from "../../src/services/loan-installments.js";

// Five monthly installments of 1000 principal + 100 margin on a 5000 loan.
const SCHEDULE = [1, 2, 3, 4, 5].map((n) => ({
  n,
  dueDate: `2026-0${n}-13`,
  pokok: "1000",
  sewaModal: "100",
  angsuran: "1100",
  sisaPokok: String(5000 - n * 1000),
}));

async function balanceOf(db: DB, loanId: string): Promise<string | undefined> {
  const rows = await db.select().from(transactions).where(eq(transactions.loanId, loanId));
  return loanBalances(rows as unknown as CoreTransaction[])[loanId];
}

describe("bookDueInstallments", () => {
  let db: DB;
  let portfolioId: string;
  let instrumentId: string;
  let importId: string;
  let loanId: string;

  beforeAll(async () => {
    db = await ensureDb();
    const [u] = await db
      .insert(users)
      .values({ authSub: "loan-inst-user", email: "loan-inst@example.com" })
      .returning();
    const [pf] = await db
      .insert(portfolios)
      .values({ userId: u.id, name: "Loan Inst", baseCurrency: "IDR", cashCounted: false })
      .returning();
    portfolioId = pf.id;
    const [instr] = await db
      .insert(instruments)
      .values({
        symbol: "G24:INST-1",
        market: "GALERI24",
        assetClass: "gold",
        currency: "IDR",
        name: "LM 5 Gram",
      })
      .returning();
    instrumentId = instr.id;
    const [imp] = await db
      .insert(screenshotImports)
      .values({ userId: u.id, portfolioId, status: "confirmed" })
      .returning();
    importId = imp.id;
    const [loan] = await db
      .insert(loans)
      .values({
        portfolioId,
        instrumentId,
        importId,
        contractNo: "INST-1",
        provider: "GALERI24",
        purchasePrice: "6000",
        principal: "5000",
        marginTotal: "500",
        tenorMonths: 5,
        monthlyInstallment: "1100",
        startDate: "2025-12-13",
        schedule: SCHEDULE,
        currency: "IDR",
      })
      .returning();
    loanId = loan.id;
    // What the import wrote: the drawdown, plus installment 1 (already due at import time).
    await db.insert(transactions).values([
      {
        portfolioId,
        instrumentId: null,
        type: "loan_drawdown",
        quantity: "0",
        price: "5000",
        fees: "0",
        currency: "IDR",
        executedAt: new Date("2025-12-13T00:00:00.000Z"),
        source: "pdf",
        importId,
        loanId,
        externalId: `import:${importId}:loan:0:1`,
      },
      {
        portfolioId,
        instrumentId: null,
        type: "loan_repayment",
        quantity: "0",
        price: "1000",
        fees: "100",
        currency: "IDR",
        executedAt: new Date("2026-01-13T00:00:00.000Z"),
        source: "pdf",
        importId,
        loanId,
        installmentN: 1,
        externalId: `import:${importId}:loan:0:2`,
      },
    ]);
  });

  afterAll(async () => {
    await closeDb();
  });

  it("books only the installments that are due and not already booked", async () => {
    expect(await balanceOf(db, loanId)).toBe("4000");

    const res = await bookDueInstallments(db, new Date("2026-03-20T12:00:00.000Z"));
    expect(res.booked).toBe(2); // installments 2 and 3; 1 was booked by the import

    const repayments = (
      await db.select().from(transactions).where(eq(transactions.loanId, loanId))
    ).filter((t) => t.type === "loan_repayment");
    expect(repayments).toHaveLength(3);
    expect(await balanceOf(db, loanId)).toBe("2000");
  });

  it("writes rows that inherit the contract's source and import, with margin in fees", async () => {
    const rows = await db.select().from(transactions).where(eq(transactions.loanId, loanId));
    const inst2 = rows.find((t) => t.externalId === `loan:${loanId}:inst:2`);
    expect(inst2).toBeDefined();
    expect(inst2).toMatchObject({
      type: "loan_repayment",
      price: "1000",
      fees: "100",
      currency: "IDR",
      source: "pdf",
      importId,
      portfolioId,
      instrumentId: null,
    });
    expect(inst2!.executedAt.toISOString()).toBe("2026-02-13T00:00:00.000Z");
  });

  it("is idempotent: a second run books nothing", async () => {
    const res = await bookDueInstallments(db, new Date("2026-03-20T12:00:00.000Z"));
    expect(res.booked).toBe(0);
    expect(await balanceOf(db, loanId)).toBe("2000");
  });

  it("books an installment on its due date and clears the loan at the end of the schedule", async () => {
    // Day before installment 4 is due: still nothing new.
    expect((await bookDueInstallments(db, new Date("2026-04-12T23:59:59.000Z"))).booked).toBe(0);
    // Exactly at installment 5's due instant: 4 and 5 book.
    const res = await bookDueInstallments(db, new Date("2026-05-13T00:00:00.000Z"));
    expect(res.booked).toBe(2);
    expect(await balanceOf(db, loanId)).toBe("0");
  });

  it("removes the auto-booked rows when the import is undone", async () => {
    await db.delete(transactions).where(eq(transactions.importId, importId));
    await db.delete(loans).where(eq(loans.importId, importId));
    expect(await db.select().from(transactions).where(eq(transactions.loanId, loanId))).toEqual([]);
  });

  it("does not re-book an installment the user settled on a different day", async () => {
    const [l] = await db
      .insert(loans)
      .values({
        portfolioId,
        instrumentId,
        contractNo: "LATE",
        provider: "GALERI24",
        purchasePrice: "3000",
        principal: "3000",
        tenorMonths: 3,
        startDate: "2026-01-01",
        schedule: [1, 2, 3].map((n) => ({
          n,
          dueDate: `2026-0${n}-10`,
          pokok: "1000",
          sewaModal: "0",
          angsuran: "1000",
          sisaPokok: String(3000 - n * 1000),
        })),
        currency: "IDR",
      })
      .returning();
    // Installment 1 (due Jan 10) was paid by hand three days late and recorded on Jan 13.
    await db.insert(transactions).values({
      portfolioId,
      instrumentId: null,
      type: "loan_repayment",
      quantity: "0",
      price: "1000",
      fees: "0",
      currency: "IDR",
      executedAt: new Date("2026-01-13T00:00:00.000Z"),
      source: "manual",
      loanId: l.id,
      installmentN: 1,
      externalId: "manual-late-1",
    });

    const res = await bookDueInstallments(db, new Date("2026-03-20T00:00:00.000Z"), {
      loanId: l.id,
    });
    expect(res.booked).toBe(2); // installments 2 and 3 — not a second copy of 1
    const rows = await db.select().from(transactions).where(eq(transactions.loanId, l.id));
    expect(rows.filter((t) => t.type === "loan_repayment")).toHaveLength(3);
    expect(rows.map((t) => t.externalId)).not.toContain(`loan:${l.id}:inst:1`);
  });

  const mkLoan = async (contractNo: string, extra: Partial<typeof loans.$inferInsert> = {}) => {
    const [l] = await db
      .insert(loans)
      .values({
        portfolioId,
        instrumentId,
        contractNo,
        provider: "GALERI24",
        purchasePrice: "3000",
        principal: "3000",
        tenorMonths: 3,
        startDate: "2026-01-01",
        schedule: [1, 2, 3].map((n) => ({
          n,
          dueDate: `2026-0${n}-10`,
          pokok: "1000",
          sewaModal: "0",
          angsuran: "1000",
          sisaPokok: String(3000 - n * 1000),
        })),
        currency: "IDR",
        ...extra,
      })
      .returning();
    return l;
  };
  const repaymentsOf = async (id: string) =>
    (await db.select().from(transactions).where(eq(transactions.loanId, id)))
      .filter((t) => t.type === "loan_repayment")
      .sort((a, b) => (a.installmentN ?? 99) - (b.installmentN ?? 99));

  it("an extra repayment that names no installment does not suppress a scheduled one", async () => {
    const l = await mkLoan("EXTRA");
    // A lump sum recorded against the loan, not tied to any installment.
    await db.insert(transactions).values({
      portfolioId,
      instrumentId: null,
      type: "loan_repayment",
      quantity: "0",
      price: "500",
      fees: "0",
      currency: "IDR",
      executedAt: new Date("2026-01-05T00:00:00.000Z"),
      source: "manual",
      loanId: l.id,
      externalId: "manual-extra",
    });
    const res = await bookDueInstallments(db, new Date("2026-03-20T00:00:00.000Z"), {
      loanId: l.id,
    });
    expect(res.booked).toBe(3); // all three scheduled installments, unaffected by the extra
    expect((await repaymentsOf(l.id)).map((t) => t.installmentN)).toEqual([1, 2, 3, null]);
  });

  it("never books a skipped installment, and keeps booking the others", async () => {
    const l = await mkLoan("SKIP");
    const schedule = (l.schedule as { n: number }[]).map((r) =>
      r.n === 2 ? { ...r, skipped: true } : r,
    );
    await db.update(loans).set({ schedule }).where(eq(loans.id, l.id));
    const now = new Date("2026-03-20T00:00:00.000Z");
    expect((await bookDueInstallments(db, now, { loanId: l.id })).booked).toBe(2);
    expect((await repaymentsOf(l.id)).map((t) => t.installmentN)).toEqual([1, 3]);
    expect((await bookDueInstallments(db, now, { loanId: l.id })).booked).toBe(0);
  });

  it("books nothing for a loan that was paid off early", async () => {
    const l = await mkLoan("CLOSED", { closedAt: "2026-01-20" });
    const res = await bookDueInstallments(db, new Date("2026-06-01T00:00:00.000Z"), {
      loanId: l.id,
    });
    expect(res.booked).toBe(0);
    expect(await repaymentsOf(l.id)).toEqual([]);
  });

  it("skips loans without a schedule and honours the loanId filter", async () => {
    const mk = async (contractNo: string, schedule: unknown) => {
      const [l] = await db
        .insert(loans)
        .values({
          portfolioId,
          instrumentId,
          contractNo,
          provider: "GALERI24",
          purchasePrice: "2000",
          principal: "2000",
          tenorMonths: 2,
          startDate: "2026-01-01",
          schedule,
          currency: "IDR",
        })
        .returning();
      return l;
    };
    const rows = [1, 2].map((n) => ({
      n,
      dueDate: `2026-0${n}-01`,
      pokok: "1000",
      sewaModal: "0",
      angsuran: "1000",
      sisaPokok: "0",
    }));
    const a = await mk("A", rows);
    const b = await mk("B", rows);
    await mk("NOSCHED", null);

    const now = new Date("2026-06-01T00:00:00.000Z");
    expect((await bookDueInstallments(db, now, { loanId: a.id })).booked).toBe(2);
    const bRows = await db.select().from(transactions).where(eq(transactions.loanId, b.id));
    expect(bRows).toEqual([]); // B untouched by the filtered run
    // No drawdown row exists for these loans, so the source falls back to "manual".
    const aRows = await db.select().from(transactions).where(eq(transactions.loanId, a.id));
    expect(aRows.every((t) => t.source === "manual" && t.importId === null)).toBe(true);

    // Unfiltered run books B's two and nothing for the schedule-less loan.
    expect((await bookDueInstallments(db, now)).booked).toBe(2);
  });
});
