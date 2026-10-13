/**
 * Compile-time contract between the `@portfolio/schema` response schemas and the
 * hand-written client interfaces. Direction matters: what the schema validates must be
 * assignable TO the interface the web reads, so the schema can never be looser than what
 * the UI assumes. Typechecked with the rest of `src/` (this package's tsconfig doesn't
 * include `test/`); emits nothing at runtime.
 */
import type {
  NetWorthResponse,
  PortfolioSummaryResponse,
  PaginatedTransactionsResponse,
  PaginatedNetworthTransactionsResponse,
} from "@portfolio/schema";
import type { NetWorth, PortfolioSummary, Transaction } from "./index.js";

type Assignable<From extends To, To> = [From, To];

// Re-assert on the exported shapes so a drift fails `tsc --noEmit`, not just a test run.
export type _NetWorth = Assignable<NetWorthResponse, NetWorth>;
export type _Summary = Assignable<PortfolioSummaryResponse, PortfolioSummary>;
export type _Rows = Assignable<PaginatedTransactionsResponse["rows"][number], Transaction>;
// The client types networth rows as `Transaction`, but that endpoint doesn't send the
// per-portfolio `hasDocument` / `hasFullTaxDetail` flags — it's assignable to the rest.
export type _NetworthRows = Assignable<
  PaginatedNetworthTransactionsResponse["rows"][number],
  Omit<Transaction, "hasDocument" | "hasFullTaxDetail">
>;
