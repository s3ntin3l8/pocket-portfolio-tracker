/**
 * Domain-level error classes used by `@portfolio/core` consumers. These are
 * typed so route handlers and web-tier callers can branch on a specific
 * failure mode (e.g. "this forecast needs user input before it can run")
 * without scraping message strings.
 *
 * All errors extend `Error` and carry a stable `name` for `err.name` checks
 * across serialization boundaries (Fastify → JSON-RPC → React Server Actions).
 */

/**
 * Thrown by forecast / contribution consumers when an outside-boundary
 * portfolio's contribution cannot be derived from transactions alone. The
 * user must supply an explicit `monthlyContribution` (their own assertion
 * of how much they're investing each month) before a forward-looking
 * forecast can be produced for that boundary.
 *
 * Used by `enrichContributions` and downstream `forecastValue` consumers:
 * `enrichContributions` surfaces a non-throwing flag (`requiresBudgetPlan`)
 * for UI prompts; routes that need a hard failure (e.g. a future
 * `POST /forecast` endpoint) should throw this directly.
 */
export class BudgetPlanRequiresInput extends Error {
  override readonly name = "BudgetPlanRequiresInput";
  constructor(
    message = "A user-provided monthlyContribution is required to forecast an outside-boundary portfolio",
  ) {
    super(message);
  }
}
