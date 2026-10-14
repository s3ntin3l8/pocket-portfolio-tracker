/**
 * Accept German-formatted numbers as typed off a DKB document — `"3.869,77"` → `"3869.77"`.
 * A value with a decimal comma has its dot thousands-separators stripped; a plain decimal
 * string passes through.
 */
export function normalizeDecimal(raw: string): string {
  const s = raw.trim();
  return s.includes(",") ? s.replace(/\./g, "").replace(",", ".") : s;
}
