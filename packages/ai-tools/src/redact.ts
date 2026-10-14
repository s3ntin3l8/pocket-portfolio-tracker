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
  "taxId",
  "steuerId",
  "npwp",
]);

export function isSensitiveKey(key: string): boolean {
  return SENSITIVE_KEYS.has(key);
}

export function stripSensitive<T>(value: T): T {
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
