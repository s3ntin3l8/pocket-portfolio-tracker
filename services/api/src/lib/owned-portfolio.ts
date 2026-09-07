/**
 * Defense-in-depth portfolio ownership check.
 *
 * Re-export of `ownedPortfolio` from `routes/helpers.ts`, exposed at the canonical
 * `lib/` path so route handlers can call a single, well-named helper regardless of
 * where the implementation lives. The re-import routes (ibkr, tr) and the documents
 * list route use this as a last-line check before mutating rows / applying a
 * portfolioId filter: even if the caller already passed some other ownership guard
 * (e.g. a connection row they own), this independently verifies that the portfolioId
 * they end up acting on belongs to the same user — closes a class of IDOR if any
 * upstream guard is ever regressed.
 *
 * Returns `null` when the portfolio does not exist OR belongs to another user; the
 * two failure modes deliberately collapse so the caller doesn't have to distinguish
 * "you can't see this" from "this doesn't exist" (information-leak hardening).
 */
export { ownedPortfolio } from "../routes/helpers.js";
