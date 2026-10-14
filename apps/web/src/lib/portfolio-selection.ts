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
 * (cookie scope), the holder's first LISTED portfolio (API list order) under a holder scope, otherwise the first
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

// ── URL scope (`?scope=`) ───────────────────────────────────────────────────────────
// The URL is the source of truth for which scope a page shows; the `pf` cookie above is
// only the default for scope-less URLs (and is still written by the switcher).

/** Search param carrying the scope: `all` | `p:<portfolioId>` | `h:<holderId>`. */
export const SCOPE_PARAM = "scope";

/** Request header the proxy sets from a valid `?scope=` so RSC loaders can read it
 *  without every page threading `searchParams` through. Always overwritten there. */
export const SCOPE_HEADER = "x-pocket-scope";

export type ScopeSelection =
  | { kind: "all" }
  | { kind: "portfolio"; portfolioId: string }
  | { kind: "holder"; holderId: string };

// Ids only (uuids) — a scope param is never allowed to carry free text.
const SCOPE_ID = /^[A-Za-z0-9_-]{1,64}$/;

/** Parse a `?scope=` value; null when absent or malformed (caller falls back to the cookie). */
export function parseScopeParam(value: string | null | undefined): ScopeSelection | null {
  if (!value) return null;
  if (value === "all") return { kind: "all" };
  if (value.startsWith("p:")) {
    const id = value.slice(2);
    return SCOPE_ID.test(id) ? { kind: "portfolio", portfolioId: id } : null;
  }
  if (value.startsWith("h:")) {
    const id = value.slice(2);
    return SCOPE_ID.test(id) ? { kind: "holder", holderId: id } : null;
  }
  return null;
}

export function formatScopeParam(scope: ScopeSelection): string {
  if (scope.kind === "portfolio") return `p:${scope.portfolioId}`;
  if (scope.kind === "holder") return `h:${scope.holderId}`;
  return "all";
}

/** Cookie (`pf`) encoding of a scope. */
export function scopeToCookieValue(scope: ScopeSelection): string {
  if (scope.kind === "portfolio") return scope.portfolioId;
  if (scope.kind === "holder") return `${HOLDER_SCOPE_PREFIX}${scope.holderId}`;
  return "all";
}

/** Persist a scope pick as the `pf` cookie (the default for scope-less URLs). */
export function persistScopeCookie(scope: ScopeSelection): void {
  const oneYear = 60 * 60 * 24 * 365;
  document.cookie = `${SELECTED_PORTFOLIO_COOKIE}=${scopeToCookieValue(scope)}; path=/; max-age=${oneYear}; samesite=lax`;
}

/** Decode the `pf` cookie value (absent / "all" = aggregate). */
export function parseCookieScope(value: string | null | undefined): ScopeSelection {
  if (!value || value === "all") return { kind: "all" };
  if (value.startsWith(HOLDER_SCOPE_PREFIX)) {
    return { kind: "holder", holderId: value.slice(HOLDER_SCOPE_PREFIX.length) };
  }
  return { kind: "portfolio", portfolioId: value };
}

/** Precedence: a valid `?scope=` param > the `pf` cookie > all portfolios. */
export function resolveScope(input: {
  param?: string | null;
  cookie?: string | null;
}): ScopeSelection {
  return parseScopeParam(input.param) ?? parseCookieScope(input.cookie);
}

type ParamSource = string | { get(name: string): string | null } | null | undefined;

/**
 * Carry the scope visible in the current URL onto an internal link, so deep links and
 * back/forward keep the scope the user was looking at. No-ops when the current URL has no
 * (valid) scope, when `href` already names a scope, or for non-internal hrefs.
 */
export function withScope(href: string, source: ParamSource): string {
  if (!href.startsWith("/") || href.startsWith("//")) return href;
  const raw =
    typeof source === "string"
      ? new URLSearchParams(source).get(SCOPE_PARAM)
      : source?.get(SCOPE_PARAM);
  if (!parseScopeParam(raw)) return href;
  const hashAt = href.indexOf("#");
  const hash = hashAt === -1 ? "" : href.slice(hashAt);
  const rest = hashAt === -1 ? href : href.slice(0, hashAt);
  const qAt = rest.indexOf("?");
  const path = qAt === -1 ? rest : rest.slice(0, qAt);
  const params = new URLSearchParams(qAt === -1 ? "" : rest.slice(qAt + 1));
  if (params.has(SCOPE_PARAM)) return href;
  params.set(SCOPE_PARAM, raw as string);
  return `${path}?${params.toString()}${hash}`;
}

/**
 * `pickDefaultPortfolioId` input for client code: the URL scope when valid (cookie-encoded),
 * otherwise the raw `pf` cookie out of a `document.cookie` string.
 */
export function effectiveScopeValue(
  param: string | null | undefined,
  cookieString: string,
): string | null {
  const fromUrl = parseScopeParam(param);
  return fromUrl ? scopeToCookieValue(fromUrl) : readSelectedScope(cookieString);
}
