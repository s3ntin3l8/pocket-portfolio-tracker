/**
 * Keys that must never reach a model, at any depth. `Portfolio` (with `accountNumber` /
 * `iban`) nests inside other responses, so redaction is one deep walk at the tool boundary
 * rather than a per-tool pick-list that leaks the first time a new nesting appears.
 */
const SENSITIVE_KEYS = new Set([
  "accountNumber",
  "iban",
  "userId",
  "birthYear",
  "email",
  "phone",
  "phoneEnc",
  "pin",
  "pinEnc",
  "token",
  "secret",
  "password",
  // Not on any field today; reserved for upcoming tax-regime fields, so keep them.
  "taxId",
  "steuerId",
  "npwp",
]);

export function isSensitiveKey(key: string): boolean {
  return SENSITIVE_KEYS.has(key);
}

/** IBAN-shaped runs (15+ chars, so 12-char ISINs survive) inside free text, spaced or not. */
const IBAN_IN_TEXT = /\b[A-Z]{2}\d{2}(?:\s?[A-Z0-9]){11,30}\b/g;

export function scrubText(s: string): string {
  return s.replace(IBAN_IN_TEXT, "[iban]");
}

export function stripSensitive<T>(value: T): T {
  if (typeof value === "string") return scrubText(value) as T;
  if (Array.isArray(value)) return value.map((v) => stripSensitive(v)) as T;
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (!isSensitiveKey(k)) out[k] = stripSensitive(v);
    }
    return out as T;
  }
  return value;
}
