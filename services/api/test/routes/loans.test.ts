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

  it("two concurrent payoffs: one wins, the other is refused (never a 500)", async () => {
    const id = await mkLoan();
    const pay = () =>
      app.inject({
        method: "POST",
        url: url(id, "payoff"),
        headers: auth(owner),
        payload: { date: toDateKey(new Date()) },
      });
    const results = await Promise.all([pay(), pay()]);
    expect(results.map((r) => r.statusCode).sort()).toEqual([200, 409]);
    const payoffs = (await repayments(id)).filter((t) => t.externalId === `loan:${id}:payoff`);
    expect(payoffs).toHaveLength(1);
  });

  it("a payoff racing the booking job never repays more than is owed", async () => {
    const id = await mkLoan(); // 3000 drawn, 1000 repaid; installments 2 and 3 are due
    const [payoff, booked] = await Promise.all([
      app.inject({
        method: "POST",
        url: url(id, "payoff"),
        headers: auth(owner),
        payload: { date: toDateKey(new Date()) },
      }),
      bookDueInstallments(app.db, new Date(), { loanId: id }),
    ]);
    // Either the job ran first (payoff finds nothing owed) or the payoff did (job books nothing).
    expect([200, 409]).toContain(payoff.statusCode);
    if (payoff.statusCode === 200) expect(booked.booked).toBe(0);
    const paid = (await repayments(id)).reduce((sum, t) => sum + Number(t.price), 0);
    expect(paid).toBe(3000);
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

  describe("manual repayments linked to a loan", () => {
    const manual = (loanId: string | null, over: Record<string, unknown> = {}) => ({
      type: "loan_repayment",
      price: "1000",
      fees: "100",
      currency: "IDR",
      executedAt: "2026-02-10T00:00:00.000Z",
      ...(loanId ? { loanId } : {}),
      ...over,
    });
    const post = (payload: Record<string, unknown>, token_ = owner, portfolio = pf) =>
      app.inject({
        method: "POST",
        url: `/portfolios/${portfolio}/transactions`,
        headers: auth(token_),
        payload,
      });

    it("links to a loan and installment, which then counts as paid and is not re-booked", async () => {
      const id = await mkLoan();
      const res = await post(manual(id, { installmentN: 2 }));
      expect(res.statusCode).toBe(201);
      expect(res.json()).toMatchObject({ loanId: id, installmentN: 2 });

      const list = await app.inject({
        method: "GET",
        url: `/portfolios/${pf}/loans`,
        headers: auth(owner),
      });
      const loan = list.json().find((l: { loanId: string }) => l.loanId === id);
      expect(loan.installments.map((i: { status: string }) => i.status)).toEqual([
        "paid",
        "paid",
        "overdue",
      ]);

      await bookDueInstallments(app.db, new Date("2026-06-01T00:00:00Z"), { loanId: id });
      expect((await repayments(id)).map((t) => t.installmentN)).toEqual([1, 2, 3]);
    });

    it("can link to the loan alone (no installment)", async () => {
      const id = await mkLoan();
      const res = await post(manual(id));
      expect(res.statusCode).toBe(201);
      expect(res.json()).toMatchObject({ loanId: id, installmentN: null });
    });

    it("rejects an installment already covered, a closed loan, an unknown n and a currency mismatch", async () => {
      const id = await mkLoan();
      const paid = await post(manual(id, { installmentN: 1 }));
      expect(paid.statusCode).toBe(409);
      expect(paid.json()).toEqual({
        error: "installment_already_paid",
      });
      const unknown = await post(manual(id, { installmentN: 9 }));
      expect(unknown.statusCode).toBe(404);
      expect(unknown.json()).toEqual({
        error: "installment_not_found",
      });
      const currency = await post(manual(id, { installmentN: 2, currency: "EUR" }));
      expect(currency.statusCode).toBe(400);
      expect(currency.json()).toEqual({
        error: "currency_mismatch",
      });
      await app.inject({
        method: "POST",
        url: url(id, "payoff"),
        headers: auth(owner),
        payload: { date: toDateKey(new Date()) },
      });
      const closed = await post(manual(id));
      expect(closed.statusCode).toBe(409);
      expect(closed.json()).toEqual({ error: "loan_closed" });
    });

    it("404s for another portfolio's loan and 400s a link on a non-repayment", async () => {
      const id = await mkLoan();
      const other = await app.inject({
        method: "POST",
        url: "/portfolios",
        headers: auth(stranger),
        payload: { name: "Other", baseCurrency: "idr", cashCounted: false },
      });
      const res = await post(manual(id), stranger, other.json().id);
      expect(res.statusCode).toBe(404);
      expect(res.json()).toEqual({ error: "loan_not_found" });

      const bad = await post({ ...manual(id), type: "deposit" });
      expect(bad.statusCode).toBe(400);
    });

    it("paying a skipped installment clears its skip flag", async () => {
      const id = await mkLoan();
      await app.inject({
        method: "POST",
        url: url(id, "installments/2/skip"),
        headers: auth(owner),
      });
      expect(skippedNs(await loanRow(id))).toEqual([2]);
      expect((await post(manual(id, { installmentN: 2 }))).statusCode).toBe(201);
      expect(skippedNs(await loanRow(id))).toEqual([]);
    });

    it("PATCH keeps/changes the link, re-saving the same installment is not a conflict", async () => {
      const id = await mkLoan();
      const created = (await post(manual(id, { installmentN: 2 }))).json();
      const patch = (payload: Record<string, unknown>, txId = created.id) =>
        app.inject({
          method: "PATCH",
          url: `/portfolios/${pf}/transactions/${txId}`,
          headers: auth(owner),
          payload: { ...manual(null), ...payload },
        });
      // Omitting loanId/installmentN (a client unaware of links) leaves them as stored.
      const same = await patch({ fees: "150" });
      expect(same.statusCode).toBe(200);
      expect(same.json()).toMatchObject({ loanId: id, installmentN: 2, fees: "150" });
      // Explicit re-send of the same installment is fine too.
      expect((await patch({ loanId: id, installmentN: 2 })).statusCode).toBe(200);
      // Moving to a covered installment conflicts; to a free one works.
      expect((await patch({ loanId: id, installmentN: 1 })).statusCode).toBe(409);
      expect((await patch({ loanId: id, installmentN: 3 })).json()).toMatchObject({
        installmentN: 3,
      });
      // null unlinks; changing the type drops the link.
      expect((await patch({ loanId: null, installmentN: null })).json()).toMatchObject({
        loanId: null,
        installmentN: null,
      });
      const relinked = (await post(manual(id, { installmentN: 2 }))).json();
      const asDeposit = await patch({ type: "deposit" }, relinked.id);
      expect(asDeposit.json()).toMatchObject({ loanId: null, installmentN: null });
    });

    it("locks the link of an auto-booked installment but lets its amounts be edited", async () => {
      const id = await mkLoan();
      await bookDueInstallments(app.db, new Date("2026-06-01T00:00:00Z"), { loanId: id });
      const two = (await repayments(id)).find((t) => t.installmentN === 2)!;
      const patch = (payload: Record<string, unknown>) =>
        app.inject({
          method: "PATCH",
          url: `/portfolios/${pf}/transactions/${two.id}`,
          headers: auth(owner),
          payload: {
            ...manual(null),
            externalId: two.externalId,
            source: two.source,
            ...payload,
          },
        });
      expect((await patch({ fees: "120" })).statusCode).toBe(200);
      const moved = await patch({ loanId: id, installmentN: 3 });
      expect(moved.statusCode).toBe(409);
      expect(moved.json()).toEqual({ error: "loan_link_locked" });
    });

    it("GET /loans is scoped to the portfolio", async () => {
      const id = await mkLoan();
      const mine = await app.inject({
        method: "GET",
        url: `/portfolios/${pf}/loans`,
        headers: auth(owner),
      });
      expect(mine.statusCode).toBe(200);
      expect(mine.json().some((l: { loanId: string }) => l.loanId === id)).toBe(true);
      const foreign = await app.inject({
        method: "GET",
        url: `/portfolios/${pf}/loans`,
        headers: auth(stranger),
      });
      expect(foreign.statusCode).toBe(404);
    });
  });
});
