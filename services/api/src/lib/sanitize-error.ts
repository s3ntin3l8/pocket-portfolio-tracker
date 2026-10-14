import {
  PytrApprovalError,
  PytrAuthError,
  PytrCodeInvalidError,
  PytrCodeRequiredError,
  PytrError,
  PytrUnavailableError,
} from "../services/pytr/errors.js";

const MAX_LEN = 140;

/** Collapse to a single line, drop URLs / absolute paths / long token-like runs, cap length. */
export function oneLine(raw: string): string {
  const first =
    raw
      .split(/\r?\n/)
      .map((l) => l.trim())
      .find((l) => l.length > 0) ?? "";
  const cleaned = first
    .replace(/https?:\/\/\S+/gi, "[url]")
    .replace(/(?:\/[\w.@-]+){2,}/g, "[path]")
    .replace(/[A-Za-z0-9_\-+=]{24,}/g, "[redacted]")
    .replace(/\d{10,}/g, "[redacted]");
  return cleaned.length > MAX_LEN ? `${cleaned.slice(0, MAX_LEN - 1)}…` : cleaned;
}

/**
 * The text we persist to a broker connection's `lastError` (and echo to the user): a short,
 * single-line, stable message. Raw subprocess stderr / stack text never lands here — callers
 * log the full error at `error` level instead.
 */
export function sanitizeConnectionError(err: unknown, fallback = "sync failed"): string {
  if (err instanceof PytrAuthError) return "Trade Republic session expired";
  if (err instanceof PytrApprovalError) return "Trade Republic login was not approved";
  if (err instanceof PytrCodeInvalidError)
    return "Trade Republic authenticator code was not accepted";
  if (err instanceof PytrCodeRequiredError) return "Trade Republic authenticator code is required";
  if (err instanceof PytrUnavailableError) return "pytr is not available";
  if (err instanceof PytrError) {
    // PytrError carries raw subprocess stderr. Both branches return a FIXED literal, never
    // `err.message`; do not swap them or stderr leaks into the stored/echoed lastError.
    return /timed out/i.test(err.message)
      ? "pytr process timed out"
      : "pytr failed (see server logs)";
  }
  if (err instanceof Error) return oneLine(err.message) || fallback;
  return fallback;
}
