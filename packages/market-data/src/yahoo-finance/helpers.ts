import { toDateKey } from "@portfolio/core";

/** Unwrap Yahoo's `{ raw, fmt }` number wrapper (or a bare number/undefined/`{}`). */
function unwrapNumber(v: unknown): number | null {
  if (typeof v === "number") return v;
  if (v && typeof v === "object" && "raw" in v && typeof (v as { raw: unknown }).raw === "number") {
    return (v as { raw: number }).raw;
  }
  return null;
}

/** Unwrap a Yahoo unix-seconds `{ raw, fmt }` timestamp to a YYYY-MM-DD date string. */
function unixToIsoDate(v: unknown): string | null {
  const n = unwrapNumber(v);
  return n ? toDateKey(new Date(n * 1000)) : null;
}

export { unwrapNumber, unixToIsoDate };
