import type { FastifyInstance } from "fastify";
import {
  and,
  count,
  desc,
  eq,
  getTableColumns,
  gte,
  inArray,
  lt,
  notInArray,
  or,
  sql,
  type SQL,
} from "drizzle-orm";
import { portfolios, transactions, users } from "@portfolio/db";
import { ACQUISITION_TYPES, INCOME_TYPES } from "@portfolio/core";
import { withDerivationCache } from "../../lib/derivation-cache.js";
import { CONFIRMED_TX_STATUSES } from "../../services/import-policy.js";
import { parsePagination, cacheKey, ALL_ROWS_CAP } from "../helpers.js";
import {
  yearRange,
  computeConvertedSummary,
  transactionsCache,
  networthTransactionsCache,
} from "./shared.js";
import { enrichRows, enrichAggregateRows } from "./list-enrichment.js";

// Fetch-by-id support for the "Show flagged only" / "Needs review" filter (#562): the
// client already knows every flagged transaction's id (from the anomalies endpoint) but
// those rows may sit past the current page. `ids` lets it fetch exactly those rows,
// regardless of pagination, instead of filtering only what's already loaded client-side.
// Only UUID-shaped ids reach the query — a malformed one would be a Postgres cast error
// (500). A present-but-all-invalid list stays an (empty) array lookup, never falls back to
// the default page (a caller expecting an array would get the page object).
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function parseIdsParam(raw: string | undefined): string[] | null {
  if (raw === undefined) return null;
  const tokens = raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (tokens.length === 0) return null;
  return tokens.filter((t) => UUID_RE.test(t));
}

/**
 * The summary totals (Invested/Proceeds/Income) count confirmed rows only (audit B5):
 * `normal` and `cash_neutral` — the same set every derivation reads through `toCoreTxns`
 * (drafts are unconfirmed, archived rows are excluded from all derivations). The row list
 * itself keeps showing drafts/archived rows so the user can confirm or un-archive them.
 *
 * The set lives in `services/import-policy.ts` because the dedup candidate set must use the
 * identical predicate: a row no derivation can see must not be able to block an import.
 */
function summaryConditions(conditions: SQL[]): SQL[] {
  return [...conditions, inArray(transactions.status, [...CONFIRMED_TX_STATUSES])];
}

/**
 * The transaction types that are *pure cash movements* — money crossing the portfolio's
 * cash boundary and nothing else.
 *
 * The rows are always imported; the portfolio's `cashCounted` toggle decides whether they
 * are *counted* (net worth, cash balance, contributions) and whether they are *shown* here.
 * For an invest-only (cash-outside) portfolio the transaction list is the securities ledger,
 * so these rows are filtered out of the query — the data is still in the database, and every
 * derivation reads it from there directly (routes/transactions/shared/helpers.ts), never
 * through this route.
 *
 * Only the broker-reported cash movements are hidden. A hand-authored `adjustment` (the
 * user's own cash true-up) and the loan rows stay visible: they are not cash transactions,
 * they have their own surfaces, and hiding a row the user authored would make it
 * unreachable from the ledger.
 */
const CASH_TRANSACTION_TYPES = ["deposit", "withdrawal"] as const;

/**
 * The list condition that hides the pure cash rows of the given cash-outside portfolios.
 *
 * A row is hidden when *its* portfolio is cash-outside AND it is a cash movement — so a
 * networth scope spanning several portfolios hides each portfolio's cash rows according to
 * that portfolio's own boundary. `type` and `portfolioId` are both NOT NULL, so the
 * `NOT IN` semantics are unambiguous.
 */
function hideCashRows(cashOutsidePortfolioIds: string[]): SQL | undefined {
  if (cashOutsidePortfolioIds.length === 0) return undefined;
  return or(
    notInArray(transactions.portfolioId, cashOutsidePortfolioIds),
    notInArray(transactions.type, [...CASH_TRANSACTION_TYPES]),
  );
}

/**
 * Response shape for a list request (audit D5). No `page` used to mean "every row, no
 * bound, no order"; now it means the first page. An unpaginated array is returned only
 * for an explicit `?all=1` (hard-capped at {@link ALL_ROWS_CAP}, newest first) or an
 * `?ids=` lookup (bounded by the id list itself).
 */
function wantsArray(query: { page?: string }, all: boolean, ids: string[] | null): boolean {
  return query.page === undefined && (all || ids !== null);
}

/** Drafts matching the non-status filters — the number behind the "Drafts only" chip. */
async function countDrafts(app: FastifyInstance, conditions: SQL[]): Promise<number> {
  const [r] = await app.db
    .select({ count: count() })
    .from(transactions)
    .where(and(...conditions, eq(transactions.status, "draft")));
  return Number(r?.count ?? 0);
}

/**
 * `?all=1&fields=ids` — just `{ id, portfolioId, status }` for every matching row (capped
 * at {@link ALL_ROWS_CAP}), skipping enrichment. Backs "select all N matching": the bulk
 * endpoints take id lists, and enriching thousands of rows only to read their ids is waste.
 */
async function selectKeys(app: FastifyInstance, conditions: SQL[]) {
  const fetched = await app.db
    .select({
      id: transactions.id,
      portfolioId: transactions.portfolioId,
      status: transactions.status,
    })
    .from(transactions)
    .where(and(...conditions))
    .orderBy(desc(transactions.executedAt))
    .limit(ALL_ROWS_CAP + 1);
  const truncated = fetched.length > ALL_ROWS_CAP;
  return { rows: truncated ? fetched.slice(0, ALL_ROWS_CAP) : fetched, truncated };
}

export function registerListRoutes(app: FastifyInstance) {
  app.get<{
    Params: { portfolioId: string };
    Querystring: {
      convertTo?: string;
      page?: string;
      pageSize?: string;
      type?: string;
      year?: string;
      q?: string;
      ids?: string;
      instrumentId?: string;
      status?: string;
      fields?: string;
      all?: string;
    };
  }>(
    "/portfolios/:portfolioId/transactions",
    { preHandler: [app.authenticate, app.requirePortfolio] },
    async (request, reply) => {
      const t0 = performance.now();
      const portfolioName = request.portfolio.name;
      const { page, pageSize, all } = parsePagination({
        page: request.query.page,
        pageSize: request.query.pageSize,
        all: request.query.all,
      });

      const convertTo = request.query.convertTo;
      const typeFilter = request.query.type;
      const yearFilter = request.query.year;
      const searchQuery = request.query.q;
      const idsFilter = parseIdsParam(request.query.ids);
      const instrumentIdFilter = request.query.instrumentId;
      const draftsOnly = request.query.status === "draft";
      const paginate = !wantsArray(request.query, all, idsFilter);

      const conditions = [eq(transactions.portfolioId, request.params.portfolioId)];
      // The portfolio's cash boundary decides whether the pure cash rows are part of the
      // transaction view. An invest-only portfolio shows the securities ledger; the rows
      // themselves are always stored (and always counted by the tax/anomaly/summary
      // derivations, which read the database directly).
      const cashOutside = request.portfolio.cashCounted ? [] : [request.params.portfolioId];
      const cashCondition = hideCashRows(cashOutside);
      if (cashCondition) conditions.push(cashCondition);
      if (idsFilter) conditions.push(inArray(transactions.id, idsFilter));
      if (instrumentIdFilter) conditions.push(eq(transactions.instrumentId, instrumentIdFilter));
      if (typeFilter === "buy") conditions.push(inArray(transactions.type, ACQUISITION_TYPES));
      if (typeFilter === "sell") conditions.push(eq(transactions.type, "sell"));
      if (typeFilter === "income") conditions.push(inArray(transactions.type, INCOME_TYPES));
      if (yearFilter) {
        const y = parseInt(yearFilter, 10);
        if (!isNaN(y)) {
          const { start, end } = yearRange(y);
          conditions.push(gte(transactions.executedAt, start), lt(transactions.executedAt, end));
        }
      }
      if (searchQuery) {
        conditions.push(sql`(
    ${transactions.description}::text ILIKE '%' || ${searchQuery} || '%'
    OR ${transactions.type}::text ILIKE '%' || ${searchQuery} || '%'
    OR ${transactions.kind}::text ILIKE '%' || ${searchQuery} || '%'
    OR ${transactions.source}::text ILIKE '%' || ${searchQuery} || '%'
    OR ${transactions.currency}::text ILIKE '%' || ${searchQuery} || '%'
    OR ${transactions.instrumentId} IN (SELECT id FROM instruments WHERE symbol::text ILIKE '%' || ${searchQuery} || '%' OR name::text ILIKE '%' || ${searchQuery} || '%')
  )`);
      }

      // Rows/total honour the draft filter; the summary and `draftCount` do not (the chip
      // count is "drafts matching the other filters", the summary is confirmed rows only).
      const rowConditions = draftsOnly
        ? [...conditions, eq(transactions.status, "draft")]
        : conditions;

      if (paginate) {
        const ck = cacheKey(
          "transactions",
          request.params.portfolioId,
          page,
          pageSize,
          convertTo || "",
          typeFilter || "",
          yearFilter || "",
          searchQuery || "",
          instrumentIdFilter || "",
          idsFilter?.join(",") ?? "",
          draftsOnly ? "draft" : "",
          request.portfolio.baseCurrency,
          // The boundary decides which rows the list contains — it has to be part of the
          // key, or flipping the toggle would serve the previous set from the cache.
          request.portfolio.cashCounted ? "cash-in" : "cash-out",
        );
        const cached = await withDerivationCache(transactionsCache, ck, async () => {
          const [merged, summaryRows] = await Promise.all([
            app.db
              .select({
                ...getTableColumns(transactions),
                __total: sql<number>`count(*) over ()`,
              })
              .from(transactions)
              .where(and(...rowConditions))
              .orderBy(desc(transactions.executedAt))
              .limit(pageSize)
              .offset((page - 1) * pageSize),
            // The summary always folds to the portfolio's own baseCurrency, independent of
            // `convertTo` (which only tags rows with a client-side display rate, #465) —
            // no current caller requests the summary in a different currency.
            computeConvertedSummary(
              app,
              summaryConditions(conditions),
              request.portfolio.baseCurrency,
              request.log,
            ),
          ]);

          let cnt: number;
          let _rows: (typeof transactions.$inferSelect)[];
          if (merged.length > 0) {
            cnt = Number(merged[0].__total);
            _rows = merged.map(({ __total, ...r }) => r);
          } else {
            cnt = await app.db
              .select({ count: count() })
              .from(transactions)
              .where(and(...rowConditions))
              .then((r) => Number(r[0].count));
            _rows = [];
          }
          return enrichRows(
            app,
            _rows,
            cnt,
            summaryRows,
            portfolioName,
            request.params.portfolioId,
            convertTo,
            paginate,
            page,
            request.log,
            t0,
          );
        });
        const yearConditions = [eq(transactions.portfolioId, request.params.portfolioId)];
        if (instrumentIdFilter)
          yearConditions.push(eq(transactions.instrumentId, instrumentIdFilter));
        const [years, draftCount] = await Promise.all([
          app.db
            .select({ year: sql<number>`DISTINCT EXTRACT(YEAR FROM ${transactions.executedAt})` })
            .from(transactions)
            .where(and(...yearConditions))
            .orderBy(sql`1 DESC`),
          countDrafts(app, conditions),
        ]);
        const yearList = years.map((r) => String(r.year));
        return {
          rows: cached.rows,
          total: cached.total,
          summary: cached.summary,
          years: yearList,
          draftCount,
        };
      }

      if (request.query.fields === "ids") {
        const keys = await selectKeys(app, rowConditions);
        if (keys.truncated) reply.header("x-result-truncated", String(ALL_ROWS_CAP));
        return keys.rows;
      }

      const fetched = await app.db
        .select()
        .from(transactions)
        .where(and(...rowConditions))
        .orderBy(desc(transactions.executedAt))
        .limit(ALL_ROWS_CAP + 1);
      const truncated = fetched.length > ALL_ROWS_CAP;
      const rows = truncated ? fetched.slice(0, ALL_ROWS_CAP) : fetched;
      if (truncated) reply.header("x-result-truncated", String(ALL_ROWS_CAP));
      const result = await enrichRows(
        app,
        rows,
        rows.length,
        undefined,
        portfolioName,
        request.params.portfolioId,
        convertTo,
        paginate,
        page,
        request.log,
        t0,
      );
      return result.rows;
    },
  );

  app.get<{
    Querystring: {
      page?: string;
      pageSize?: string;
      type?: string;
      year?: string;
      q?: string;
      ids?: string;
      instrumentId?: string;
      status?: string;
      fields?: string;
      all?: string;
    };
  }>("/networth/transactions", { preHandler: app.authenticate }, async (request, reply) => {
    request.timingName = "GET /networth/transactions";
    const id = request.userId;
    const { page, pageSize, all } = parsePagination({
      page: request.query.page,
      pageSize: request.query.pageSize,
      all: request.query.all,
    });
    const typeFilter = request.query.type;
    const yearFilter = request.query.year;
    const searchQuery = request.query.q;
    const idsFilter = parseIdsParam(request.query.ids);
    const instrumentIdFilter = request.query.instrumentId;
    const draftsOnly = request.query.status === "draft";
    const paginate = !wantsArray(request.query, all, idsFilter);

    const [pfs, [u]] = await Promise.all([
      app.db
        .select({
          id: portfolios.id,
          name: portfolios.name,
          baseCurrency: portfolios.baseCurrency,
          cashCounted: portfolios.cashCounted,
        })
        .from(portfolios)
        .where(eq(portfolios.userId, id)),
      app.db
        .select({ displayCurrency: users.displayCurrency })
        .from(users)
        .where(eq(users.id, id))
        .limit(1),
    ]);
    if (pfs.length === 0) return paginate ? { rows: [], total: 0, draftCount: 0 } : [];

    const displayCurrency = u?.displayCurrency ?? "IDR";
    const pfIds = pfs.map((p) => p.id);
    const nameById = new Map(pfs.map((p) => [p.id, p.name]));

    const conditions = [inArray(transactions.portfolioId, pfIds)];
    // Each portfolio's own boundary decides whether its cash rows are part of the view —
    // a networth scope spans portfolios that may disagree.
    const cashOutsideIds = pfs.filter((p) => !p.cashCounted).map((p) => p.id);
    const cashCondition = hideCashRows(cashOutsideIds);
    if (cashCondition) conditions.push(cashCondition);
    if (idsFilter) conditions.push(inArray(transactions.id, idsFilter));
    if (instrumentIdFilter) conditions.push(eq(transactions.instrumentId, instrumentIdFilter));
    if (typeFilter === "buy") conditions.push(inArray(transactions.type, ACQUISITION_TYPES));
    if (typeFilter === "sell") conditions.push(eq(transactions.type, "sell"));
    if (typeFilter === "income") conditions.push(inArray(transactions.type, INCOME_TYPES));
    if (yearFilter) {
      const y = parseInt(yearFilter, 10);
      if (!isNaN(y)) {
        const { start, end } = yearRange(y);
        conditions.push(gte(transactions.executedAt, start), lt(transactions.executedAt, end));
      }
    }
    if (searchQuery) {
      conditions.push(sql`(
          ${transactions.description}::text ILIKE '%' || ${searchQuery} || '%'
          OR ${transactions.type}::text ILIKE '%' || ${searchQuery} || '%'
          OR ${transactions.kind}::text ILIKE '%' || ${searchQuery} || '%'
          OR ${transactions.source}::text ILIKE '%' || ${searchQuery} || '%'
          OR ${transactions.currency}::text ILIKE '%' || ${searchQuery} || '%'
          OR ${transactions.instrumentId} IN (SELECT id FROM instruments WHERE symbol::text ILIKE '%' || ${searchQuery} || '%' OR name::text ILIKE '%' || ${searchQuery} || '%')
        )`);
    }

    const rowConditions = draftsOnly
      ? [...conditions, eq(transactions.status, "draft")]
      : conditions;

    if (paginate) {
      const ck = cacheKey(
        id,
        "networth",
        page,
        pageSize,
        typeFilter ?? "",
        yearFilter ?? "",
        searchQuery ?? "",
        instrumentIdFilter ?? "",
        idsFilter?.join(",") ?? "",
        draftsOnly ? "draft" : "",
        displayCurrency,
        // The boundary decides which rows the list contains — it has to be part of the key,
        // or flipping a portfolio's toggle would serve the previous set from the cache.
        [...cashOutsideIds].sort().join(","),
      );
      const cached = await withDerivationCache(networthTransactionsCache, ck, async () => {
        const [merged, summaryRows] = await Promise.all([
          app.db
            .select({
              ...getTableColumns(transactions),
              __total: sql<number>`count(*) over ()`,
            })
            .from(transactions)
            .where(and(...rowConditions))
            .orderBy(desc(transactions.executedAt))
            .limit(pageSize)
            .offset((page - 1) * pageSize),
          computeConvertedSummary(app, summaryConditions(conditions), displayCurrency, request.log),
        ]);

        let total: number;
        let rows: (typeof transactions.$inferSelect)[];
        if (merged.length > 0) {
          total = Number(merged[0].__total);
          rows = merged.map(({ __total, ...r }) => r);
        } else {
          total = await app.db
            .select({ count: count() })
            .from(transactions)
            .where(and(...rowConditions))
            .then((r) => Number(r[0].count));
          rows = [];
        }
        const enriched = await enrichAggregateRows(app, rows, nameById, request.log);
        return { rows: enriched, total, summary: summaryRows };
      });
      const yearConditions = [inArray(transactions.portfolioId, pfIds)];
      if (instrumentIdFilter)
        yearConditions.push(eq(transactions.instrumentId, instrumentIdFilter));
      const [years, draftCount] = await Promise.all([
        app.db
          .select({ year: sql<number>`DISTINCT EXTRACT(YEAR FROM ${transactions.executedAt})` })
          .from(transactions)
          .where(and(...yearConditions))
          .orderBy(sql`1 DESC`),
        countDrafts(app, conditions),
      ]);
      const yearList = years.map((r) => String(r.year));
      request.timingMeta = {
        page,
        pageSize,
        total: cached.total,
        portfolioCount: pfs.length,
      };
      return {
        rows: cached.rows,
        total: cached.total,
        summary: cached.summary,
        years: yearList,
        draftCount,
      };
    }

    if (request.query.fields === "ids") {
      const keys = await selectKeys(app, rowConditions);
      if (keys.truncated) reply.header("x-result-truncated", String(ALL_ROWS_CAP));
      return keys.rows;
    }

    const fetched = await app.db
      .select()
      .from(transactions)
      .where(and(...rowConditions))
      .orderBy(desc(transactions.executedAt))
      .limit(ALL_ROWS_CAP + 1);
    const truncated = fetched.length > ALL_ROWS_CAP;
    const rows = truncated ? fetched.slice(0, ALL_ROWS_CAP) : fetched;
    if (truncated) reply.header("x-result-truncated", String(ALL_ROWS_CAP));
    const enriched = await enrichAggregateRows(app, rows, nameById, request.log);
    request.timingMeta = {
      rowCount: rows.length,
      portfolioCount: pfs.length,
    };
    return enriched;
  });
}
