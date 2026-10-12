/**
 * Error taxonomy for server-side data loaders. A failed load used to collapse into one
 * "unavailable" status ("Can't reach the API"), which made a rate-limit (retry in 16 s),
 * an expired session and a genuinely-down API indistinguishable to the user.
 *
 *   unauthorized — no usable credential, or the API answered 401 (session expired)
 *   rate_limited — the API answered 429; `retryAfter` is the wait in seconds when known
 *   unavailable  — anything else (network failure, 5xx, unexpected 4xx)
 */
export type DataFailure =
  | { status: "unauthorized" }
  | { status: "rate_limited"; retryAfter: number | null }
  | { status: "unavailable" };

export type DataFailureStatus = DataFailure["status"];

export function isDataFailureStatus(status: string): status is DataFailureStatus {
  return status === "unauthorized" || status === "rate_limited" || status === "unavailable";
}

/** Classify a thrown loader error (an `ApiError` from `@portfolio/api-client`, or anything). */
export function classifyFailure(err: unknown): DataFailure {
  const status = (err as { status?: unknown } | null)?.status;
  if (status === 401) return { status: "unauthorized" };
  if (status === 429) {
    const retryAfter = (err as { retryAfter?: unknown }).retryAfter;
    return {
      status: "rate_limited",
      retryAfter: typeof retryAfter === "number" && retryAfter > 0 ? retryAfter : null,
    };
  }
  return { status: "unavailable" };
}

/** The `retryAfter` carried by a rate-limited loader result, if any. */
export function retryAfterOf(result: object): number | null {
  const v = (result as { retryAfter?: unknown }).retryAfter;
  return typeof v === "number" ? v : null;
}
