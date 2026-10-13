import type { Transaction } from "@portfolio/api-client";
import {
  getServerApi,
  listPortfoliosCached,
  resolveHolderScope,
  type TransactionWithPortfolio,
} from "./_shared";
import { loadMe } from "./user";
import { classifyFailure, type DataFailure, type DataFailureStatus } from "@/lib/data-status";

/**
 * Look one transaction up across the portfolios in scope (the edit page resolves a row
 * regardless of which portfolio is selected). Fetches only that id from each portfolio
 * (`?ids=`) — the unpaginated full-list read is a bounded export since audit D5, and
 * pulling every row of every portfolio to find one was the unbounded read it replaced.
 * `transactions` holds the match (0 or 1 rows).
 */
export async function loadTransactionsAcrossPortfolios(txId: string): Promise<{
  status: "ok" | "empty" | DataFailureStatus;
  retryAfter?: number | null;
  transactions: TransactionWithPortfolio[];
  scopeCurrency: string;
}> {
  const api = await getServerApi();
  if (!api) return { status: "unauthorized", transactions: [], scopeCurrency: "IDR" };
  try {
    const allPortfolios = await listPortfoliosCached();
    if (allPortfolios.length === 0)
      return { status: "empty", transactions: [], scopeCurrency: "IDR" };
    const holderId = await resolveHolderScope(allPortfolios);
    const portfolios = holderId
      ? allPortfolios.filter((p) => p.accountHolderId === holderId)
      : allPortfolios;
    if (portfolios.length === 0) return { status: "empty", transactions: [], scopeCurrency: "IDR" };
    const me = await loadMe();
    const scopeCurrency = me?.displayCurrency ?? "IDR";
    const nameById = new Map(portfolios.map((p) => [p.id, p.name]));
    const lists = await Promise.all(
      portfolios.map((p) => api.listTransactionsByIds(p.id, [txId], scopeCurrency)),
    );
    const transactions = lists.flat().map((t) => ({
      ...t,
      portfolioName: nameById.get(t.portfolioId) ?? "",
    }));
    return { status: "ok", transactions, scopeCurrency };
  } catch (err) {
    const failure = classifyFailure(err);
    return {
      status: failure.status,
      ...(failure.status === "rate_limited" ? { retryAfter: failure.retryAfter } : {}),
      transactions: [],
      scopeCurrency: "IDR",
    };
  }
}

export async function loadNetworthTransactionsPaginated(
  page: number,
  pageSize = 25,
  type?: string,
  year?: string,
  q?: string,
  instrumentId?: string,
): Promise<
  | {
      status: "ok";
      rows: Transaction[];
      total: number;
      summary?: { totalInvested: string; totalProceeds: string; totalIncome: string };
      years?: string[];
    }
  | (DataFailure & { rows: []; total: 0 })
> {
  const api = await getServerApi();
  if (!api) return { status: "unauthorized", rows: [], total: 0 };
  try {
    const data = await api.listNetworthTransactionsPaginated(
      page,
      pageSize,
      type,
      year,
      q,
      instrumentId,
    );
    return {
      status: "ok",
      rows: data.rows,
      total: data.total,
      summary: data.summary,
      years: data.years,
    };
  } catch (err) {
    return { ...classifyFailure(err), rows: [], total: 0 };
  }
}

export async function loadTransactionsPaginated(
  portfolioId: string,
  page: number,
  pageSize = 25,
  convertTo?: string,
  type?: string,
  year?: string,
  q?: string,
  instrumentId?: string,
): Promise<
  | {
      status: "ok";
      rows: Transaction[];
      total: number;
      summary?: { totalInvested: string; totalProceeds: string; totalIncome: string };
      years?: string[];
    }
  | (DataFailure & { rows: []; total: 0 })
> {
  const api = await getServerApi();
  if (!api) return { status: "unauthorized", rows: [], total: 0 };
  try {
    const data = await api.listTransactionsPaginated(
      portfolioId,
      page,
      pageSize,
      convertTo,
      type,
      year,
      q,
      instrumentId,
    );
    return {
      status: "ok",
      rows: data.rows,
      total: data.total,
      summary: data.summary,
      years: data.years,
    };
  } catch (err) {
    return { ...classifyFailure(err), rows: [], total: 0 };
  }
}
