import { eq, min, isNotNull } from "drizzle-orm";
import { transactions, portfolioSnapshots } from "@portfolio/db";
import { toDateKey } from "@portfolio/core";
import type { MarketDataService } from "@portfolio/market-data";
import type { DB } from "../../db/client.js";
import { backfillPortfolioHistory, type BackfillResult } from "./core.js";

export interface SweepResult {
  scanned: number;
  healed: number;
  portfolios: Array<{ portfolioId: string; result: BackfillResult }>;
}

export interface SweepOptions {
  force?: boolean;
}

export async function backfillStalePortfolios(
  db: DB,
  marketData: MarketDataService,
  ttlMs: number,
  opts: SweepOptions = {},
): Promise<SweepResult> {
  const rows = await db
    .select({
      portfolioId: transactions.portfolioId,
      inception: min(transactions.executedAt),
      earliestSnapshot: min(portfolioSnapshots.date),
    })
    .from(transactions)
    .leftJoin(portfolioSnapshots, eq(transactions.portfolioId, portfolioSnapshots.portfolioId))
    .where(isNotNull(transactions.portfolioId))
    .groupBy(transactions.portfolioId);

  const toHeal = opts.force
    ? rows.filter((r) => r.portfolioId && r.inception)
    : rows.filter((r) => {
        if (!r.portfolioId || !r.inception) return false;
        const inceptionDate = toDateKey(r.inception);
        if (!r.earliestSnapshot) return true;
        return r.earliestSnapshot > inceptionDate;
      });

  const result: SweepResult = { scanned: rows.length, healed: 0, portfolios: [] };

  for (const { portfolioId } of toHeal) {
    if (!portfolioId) continue;
    const backfillResult = await backfillPortfolioHistory(db, marketData, ttlMs, portfolioId);
    result.healed++;
    result.portfolios.push({ portfolioId, result: backfillResult });
  }

  return result;
}
