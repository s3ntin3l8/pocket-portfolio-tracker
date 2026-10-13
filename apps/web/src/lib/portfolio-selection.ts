/** Cookie holding the globally-selected portfolio id (or "all" / absent = aggregate). */
export const SELECTED_PORTFOLIO_COOKIE = "pf";

/**
 * Cookie value prefix for a holder-scoped aggregate.
 * Value format: `holder:<holderId>` — absent means "all" or a plain portfolio id.
 */
export const HOLDER_SCOPE_PREFIX = "holder:";

/**
 * Returns only the account holders that own ≥2 portfolios in the provided list.
 * A holder with a single portfolio is equivalent to selecting that portfolio
 * directly via the global switcher, so it doesn't qualify for the holder section.
 */
export function qualifyingHolders<
  P extends { accountHolderId?: string | null },
  H extends { id: string },
>(portfolios: P[], holders: H[]): H[] {
  const count = new Map<string, number>();
  for (const p of portfolios) {
    if (p.accountHolderId) {
      count.set(p.accountHolderId, (count.get(p.accountHolderId) ?? 0) + 1);
    }
  }
  return holders.filter((h) => (count.get(h.id) ?? 0) >= 2);
}

/** The raw value of the selection cookie out of a `document.cookie` string, or null. */
export function readSelectedScope(cookieString: string): string | null {
  for (const part of cookieString.split(";")) {
    const [name, ...rest] = part.trim().split("=");
    if (name === SELECTED_PORTFOLIO_COOKIE) {
      const value = decodeURIComponent(rest.join("="));
      return value || null;
    }
  }
  return null;
}

/**
 * Which portfolio a "new entry" form should preselect: the globally selected portfolio
 * (cookie scope), the holder's first portfolio under a holder scope, otherwise the first
 * portfolio. Falls back to the first when the cookie names a portfolio that no longer
 * exists. Returns "" only when there are no portfolios at all.
 */
export function pickDefaultPortfolioId(
  portfolios: { id: string; accountHolderId?: string | null }[],
  scope: string | null,
): string {
  if (scope && scope !== "all") {
    if (scope.startsWith(HOLDER_SCOPE_PREFIX)) {
      const holderId = scope.slice(HOLDER_SCOPE_PREFIX.length);
      const match = portfolios.find((p) => p.accountHolderId === holderId);
      if (match) return match.id;
    } else if (portfolios.some((p) => p.id === scope)) {
      return scope;
    }
  }
  return portfolios[0]?.id ?? "";
}
