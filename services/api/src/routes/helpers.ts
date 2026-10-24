import type { FastifyInstance, FastifyReply } from "fastify";
import { and, eq } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import type { PgTable } from "drizzle-orm/pg-core";
import { accountHolders, portfolios } from "@portfolio/db";
import { flattenJoinRow } from "../lib/portfolio.js";

/** Unified ownership check — portfolio exists + belongs to user. */
export async function ownedPortfolio(app: FastifyInstance, userId: string, portfolioId: string) {
  const [row] = await app.db
    .select()
    .from(portfolios)
    .leftJoin(accountHolders, eq(portfolios.accountHolderId, accountHolders.id))
    .where(and(eq(portfolios.id, portfolioId), eq(portfolios.userId, userId)))
    .limit(1);
  return row ? flattenJoinRow(row) : null;
}

export interface PaginationParams {
  page: number;
  /** Rows per page; `0` = unpaginated (only for `all=1`, or a caller opting into the
   *  legacy unpaginated default — the bound is then the caller's responsibility). */
  pageSize: number;
  /** `?all=1`: the caller explicitly asked for every row (still hard-capped by the route,
   *  see {@link ALL_ROWS_CAP}). */
  all: boolean;
}

export const DEFAULT_PAGE_SIZE = 25;
export const MAX_PAGE_SIZE = 100;
/** Hard ceiling on an explicit `?all=1` read (audit D5) — a bounded export, never an
 *  unbounded scan. Routes add an `x-result-truncated` header when it bites. */
export const ALL_ROWS_CAP = 5000;

/**
 * Page/pageSize from a query string. With no `page`, the default is the first page of
 * {@link DEFAULT_PAGE_SIZE} rows (audit D5: an absent `page` used to mean "every row, no
 * bound"); an explicit `?all=1` asks for the unpaginated list instead. `unpaginatedByDefault`
 * keeps the pre-D5 behavior for a list whose unpaginated read is bounded by other means
 * (the documents inbox, scoped to one user's tax-report category).
 */
export function parsePagination(
  query: { page?: string; pageSize?: string; all?: string },
  opts: { unpaginatedByDefault?: boolean } = {},
): PaginationParams {
  const rawPage = query.page;
  const rawPageSize = query.pageSize;
  if (rawPage === undefined) {
    if (query.all === "1" || query.all === "true") return { page: 1, pageSize: 0, all: true };
    if (opts.unpaginatedByDefault) return { page: 1, pageSize: 0, all: false };
  }
  const page = Math.max(1, parseInt(rawPage ?? "1", 10) || 1);
  const pageSize = Math.min(
    MAX_PAGE_SIZE,
    Math.max(1, parseInt(rawPageSize ?? String(DEFAULT_PAGE_SIZE), 10) || DEFAULT_PAGE_SIZE),
  );
  return { page, pageSize, all: false };
}

export function paginate(p: PaginationParams): { limit?: number; offset?: number } {
  if (p.pageSize <= 0) return {};
  return { limit: p.pageSize, offset: (p.page - 1) * p.pageSize };
}

/**
 * Derivation-cache key from positional parts. Every part keeps its slot — `null`,
 * `undefined` and `""` all become an empty slot rather than being dropped — so two
 * requests that differ only in WHICH filter carries a value (`year=2024` vs `q=2024`,
 * `include=X` vs `exclude=X`) never collapse onto one key (audit D4). Callers must pass a
 * fixed number of parts in a fixed order.
 *
 * The parts are **length-prefixed** before joining. A raw `|` join was ambiguous: the
 * user-controlled filter values (`?convertTo=a&typeFilter=b` and `?convertTo=a%7Cb`)
 * produced the same key, so a request could be served a response computed for a different
 * filter combination. Length-prefixing makes every part unambiguous.
 */
export function cacheKey(...parts: (string | number | null | undefined)[]): string {
  return parts
    .map((p) => {
      const s = p == null ? "" : String(p);
      return `${s.length}:${s}`;
    })
    .join("|");
}

/** Insert a row and return it with a 201 status. */
export async function createAndReturn(
  db: FastifyInstance["db"],
  reply: FastifyReply,
  table: PgTable,
  values: Record<string, unknown>,
) {
  const [created] = await db.insert(table).values(values).returning();
  reply.code(201);
  return created;
}

/** Delete a row by arbitrary conditions — 404 if missing, 204 on success. */
export async function deleteOwnedOr404(
  reply: FastifyReply,
  db: FastifyInstance["db"],
  table: PgTable,
  conditions: SQL | undefined,
  errorMessage = "not_found",
) {
  const [deleted] = await db.delete(table).where(conditions).returning();
  if (!deleted) return reply.code(404).send({ error: errorMessage });
  return reply.code(204).send();
}
