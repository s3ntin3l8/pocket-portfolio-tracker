import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { generateKeyPair, SignJWT } from "jose";
import { eq } from "drizzle-orm";
import { instruments, loans, transactions } from "@portfolio/db";
import { toDateKey } from "@portfolio/core";
import { buildApp } from "../../src/app.js";
import { closeDb } from "../../src/db/client.js";
import { bookDueInstallments } from "../../src/services/loan-installments.js";

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

const SCHEDULE = [1, 2, 3].map((n) => ({
  n,
  dueDate: `2026-0${n}-10`,
  pokok: "1000",
  sewaModal: "100",
  angsuran: "1100",
  sisaPokok: String(3000 - n * 1000),
}));

describe("loan routes (skip / payoff)", () => {
  let owner: string;
  let stranger: string;
  let pf: string;
  let instrumentId: string;
  let seq = 0;

  beforeAll(async () => {
    const kp = await generateKeyPair("ES256");
    privateKey = kp.privateKey;
    process.env.AUTHENTIK_ISSUER = ISSUER;
    process.env.AUTHENTIK_AUDIENCE = AUDIENCE;
    process.env.RATE_LIMIT_MAX = "10000";
    app = await buildApp({ authKey: kp.publicKey });
    owner = await token("loan-owner");
    stranger = await token("loan-stranger");
    await app.inject({ method: "GET", url: "/me", headers: auth(owner) });
    await app.inject({ method: "GET", url: "/me", headers: auth(stranger) });
    const res = await app.inject({
      method: "POST",
      url: "/portfolios",
      headers: auth(owner),
      payload: { name: "Loans", baseCurrency: "idr", cashCounted: false },
    });
    pf = res.json().id;
    const [instr] = await app.db
      .insert(instruments)
      .values({
        symbol: "G24:LOANRT",
        market: "GALERI24",
        assetClass: "gold",
        currency: "IDR",
        name: "LM 3 Gram",
      })
      .returning();
    instrumentId = instr.id;
  });

  afterAll(async () => {
    await app.close();
    await closeDb();
  });

  /** A 3000 loan whose installment 1 is already booked; 2 and 3 are due but unbooked. */
  async function mkLoan() {
    const [loan] = await app.db
      .insert(loans)
      .values({
        portfolioId: pf,
        instrumentId,
        contractNo: `RT-${++seq}`,
        provider: "GALERI24",
        purchasePrice: "3000",
        principal: "3000",
        tenorMonths: 3,
        monthlyInstallment: "1100",
        startDate: "2025-12-10",
        schedule: SCHEDULE,
        currency: "IDR",
      })
      .returning();
    const base = { portfolioId: pf, instrumentId: null, quantity: "0", currency: "IDR" };
    await app.db.insert(transactions).values([
      {
        ...base,
        type: "loan_drawdown",
        price: "3000",
        fees: "0",
        executedAt: new Date("2025-12-10T00:00:00Z"),
        loanId: loan.id,
        externalId: `t:${loan.id}:draw`,
      },
      {
        ...base,
        type: "loan_repayment",
        price: "1000",
        fees: "100",
        executedAt: new Date("2026-01-10T00:00:00Z"),
        loanId: loan.id,
        installmentN: 1,
        externalId: `loan:${loan.id}:inst:1`,
      },
    ]);
    return loan.id;
  }
  const url = (loanId: string, tail: string, portfolio = pf) =>
    `/portfolios/${portfolio}/loans/${loanId}/${tail}`;
  const repayments = async (loanId: string) =>
    (await app.db.select().from(transactions).where(eq(transactions.loanId, loanId)))
      .filter((t) => t.type === "loan_repayment")
      .sort((a, b) => (a.installmentN ?? 99) - (b.installmentN ?? 99));
  const loanRow = async (loanId: string) =>
    (await app.db.select().from(loans).where(eq(loans.id, loanId)))[0]!;
  const skippedNs = (l: { schedule: unknown }) =>
    (l.schedule as { n: number; skipped?: boolean }[]).filter((r) => r.skipped).map((r) => r.n);

  it("skips an installment so the booking job leaves it alone, and un-skip books it again", async () => {
    const id = await mkLoan();
    const res = await app.inject({
      method: "POST",
      url: url(id, "installments/2/skip"),
      headers: auth(owner),
    });
    expect(res.statusCode).toBe(204);
    expect(skippedNs(await loanRow(id))).toEqual([2]);

    await bookDueInstallments(app.db, new Date("2026-06-01T00:00:00Z"), { loanId: id });
    expect((await repayments(id)).map((t) => t.installmentN)).toEqual([1, 3]);

    const un = await app.inject({
      method: "DELETE",
      url: url(id, "installments/2/skip"),
      headers: auth(owner),
    });
    expect(un.statusCode).toBe(204);
    expect(skippedNs(await loanRow(id))).toEqual([]);
    // Booked immediately, not at the next 00:15 run.
    expect((await repayments(id)).map((t) => t.installmentN)).toEqual([1, 2, 3]);
  });

  it("skipping an already-booked installment removes its repayment", async () => {
    const id = await mkLoan();
    const res = await app.inject({
      method: "POST",
      url: url(id, "installments/1/skip"),
      headers: auth(owner),
    });
    expect(res.statusCode).toBe(204);
    expect(await repayments(id)).toEqual([]);
    expect(skippedNs(await loanRow(id))).toEqual([1]);
  });

  it("404s for an unknown installment, an unknown loan, and another user's portfolio", async () => {
    const id = await mkLoan();
    const post = (u: string, who = owner) =>
      app.inject({ method: "POST", url: u, headers: auth(who) });
    expect((await post(url(id, "installments/9/skip"))).json()).toEqual({
      error: "installment_not_found",
    });
    const missing = "00000000-0000-0000-0000-000000000000";
    expect((await post(url(missing, "installments/1/skip"))).json()).toEqual({
      error: "loan_not_found",
    });
    expect((await post(url(id, "installments/1/skip"), stranger)).statusCode).toBe(404);
    expect(skippedNs(await loanRow(id))).toEqual([]);
  });

  it("pays a loan off early with the remaining principal, then reopens it", async () => {
    const id = await mkLoan();
    const today = toDateKey(new Date());
    const res = await app.inject({
      method: "POST",
      url: url(id, "payoff"),
      headers: auth(owner),
      payload: { date: today, fees: "50" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ principal: "2000" });
    expect((await loanRow(id)).closedAt).toBe(today);
    const payoff = (await repayments(id)).find((t) => t.externalId === `loan:${id}:payoff`)!;
    expect(payoff).toMatchObject({ price: "2000", fees: "50", installmentN: null });

    // Closed: nothing more is booked, a second payoff is refused.
    expect((await bookDueInstallments(app.db, new Date(), { loanId: id })).booked).toBe(0);
    const again = await app.inject({
      method: "POST",
      url: url(id, "payoff"),
      headers: auth(owner),
      payload: { date: today },
    });
    expect(again.statusCode).toBe(409);
    expect(again.json()).toEqual({ error: "loan_closed" });

    const reopen = await app.inject({
      method: "DELETE",
      url: url(id, "payoff"),
      headers: auth(owner),
    });
    expect(reopen.statusCode).toBe(204);
    expect((await loanRow(id)).closedAt).toBeNull();
    // The schedule resumes: 2 and 3 are past due, so they book straight away.
    expect((await repayments(id)).map((t) => t.installmentN)).toEqual([1, 2, 3]);
    const notClosed = await app.inject({
      method: "DELETE",
      url: url(id, "payoff"),
      headers: auth(owner),
    });
    expect(notClosed.json()).toEqual({ error: "loan_not_closed" });
  });

  it("rejects a payoff dated in the future or before the last repayment", async () => {
    const id = await mkLoan();
    const pay = (date: string) =>
      app.inject({
        method: "POST",
        url: url(id, "payoff"),
        headers: auth(owner),
        payload: { date },
      });
    expect((await pay("2099-01-01")).json()).toEqual({ error: "payoff_in_future" });
    expect((await pay("2025-12-20")).json()).toEqual({ error: "payoff_before_last_repayment" });
    expect(
      (
        await app.inject({
          method: "POST",
          url: url(id, "payoff"),
          headers: auth(owner),
          payload: { date: "not-a-date" },
        })
      ).statusCode,
    ).toBe(400);
    expect((await loanRow(id)).closedAt).toBeNull();
  });

  it("rejects negative payoff fees", async () => {
    const id = await mkLoan();
    const res = await app.inject({
      method: "POST",
      url: url(id, "payoff"),
      headers: auth(owner),
      payload: { date: toDateKey(new Date()), fees: "-50" },
    });
    expect(res.statusCode).toBe(400);
    expect((await loanRow(id)).closedAt).toBeNull();
  });

  it("concurrent skips of different installments both land (no lost update)", async () => {
    const id = await mkLoan();
    const skip = (n: number) =>
      app.inject({
        method: "POST",
        url: url(id, `installments/${n}/skip`),
        headers: auth(owner),
      });
    const results = await Promise.all([skip(2), skip(3)]);
    expect(results.map((r) => r.statusCode)).toEqual([204, 204]);
    expect(skippedNs(await loanRow(id))).toEqual([2, 3]);
  });

  it("refuses a payoff when nothing is outstanding", async () => {
    const id = await mkLoan();
    await bookDueInstallments(app.db, new Date("2026-06-01T00:00:00Z"), { loanId: id });
    const res = await app.inject({
      method: "POST",
      url: url(id, "payoff"),
      headers: auth(owner),
      payload: { date: toDateKey(new Date()) },
    });
    expect(res.json()).toEqual({ error: "nothing_outstanding" });
  });

  it("deleting an auto-booked installment skips it instead of letting the job re-book it", async () => {
    const id = await mkLoan();
    await bookDueInstallments(app.db, new Date("2026-06-01T00:00:00Z"), { loanId: id });
    const two = (await repayments(id)).find((t) => t.installmentN === 2)!;
    const del = await app.inject({
      method: "DELETE",
      url: `/portfolios/${pf}/transactions/${two.id}`,
      headers: auth(owner),
    });
    expect(del.statusCode).toBe(204);
    expect(skippedNs(await loanRow(id))).toEqual([2]);
    expect(
      (await bookDueInstallments(app.db, new Date("2026-06-01T00:00:00Z"), { loanId: id })).booked,
    ).toBe(0);
    expect((await repayments(id)).map((t) => t.installmentN)).toEqual([1, 3]);
  });

  it("bulk-delete also skips, and deleting the payoff repayment reopens the loan", async () => {
    const id = await mkLoan();
    await bookDueInstallments(app.db, new Date("2026-06-01T00:00:00Z"), { loanId: id });
    const rows = await repayments(id);
    const ids = rows.filter((t) => t.installmentN === 2 || t.installmentN === 3).map((t) => t.id);
    const bulk = await app.inject({
      method: "POST",
      url: `/portfolios/${pf}/transactions/bulk-delete`,
      headers: auth(owner),
      payload: { ids },
    });
    expect(bulk.json()).toEqual({ deleted: 2 });
    expect(skippedNs(await loanRow(id))).toEqual([2, 3]);

    // Pay off what is left, then delete the payoff row by hand: the loan reopens.
    await app.inject({
      method: "POST",
      url: url(id, "payoff"),
      headers: auth(owner),
      payload: { date: toDateKey(new Date()) },
    });
    expect((await loanRow(id)).closedAt).not.toBeNull();
    const payoff = (await repayments(id)).find((t) => t.externalId === `loan:${id}:payoff`)!;
    await app.inject({
      method: "DELETE",
      url: `/portfolios/${pf}/transactions/${payoff.id}`,
      headers: auth(owner),
    });
    expect((await loanRow(id)).closedAt).toBeNull();
  });
});
