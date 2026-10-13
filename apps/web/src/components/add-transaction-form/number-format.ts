/**
 * Thousands-grouping for numeric text inputs (quantity/price/fees/tax), matching the Add
 * Transaction v2 design's `_num` input helper. The canonical value stored in form state is
 * always the RAW, dot-decimal, ungrouped string (so `use-transaction-form.ts`'s submit payload is
 * unaffected) — these helpers only govern what's *displayed* in the input.
 *
 * A leading "-" is preserved (not part of the design, which has no negative fields) because
 * the existing `adjustment` cash type accepts a signed amount (see `pricing-fields.tsx`'s
 * `adjustmentHint`) — stripping it here would regress that.
 */

const separatorCache = new Map<string, { group: string; decimal: string }>();

/** The active locale's group/decimal separators, detected from `Intl` rather than hard-coded
 *  (`en` → `,`/`.`; `id`, `de` → `.`/`,`). Falls back to the English pair for an unknown tag. */
export function localeSeparators(locale: string): { group: string; decimal: string } {
  const hit = separatorCache.get(locale);
  if (hit) return hit;
  let result = { group: ",", decimal: "." };
  try {
    const parts = new Intl.NumberFormat(locale, { useGrouping: true }).formatToParts(1234.5);
    result = {
      group: parts.find((p) => p.type === "group")?.value ?? "",
      decimal: parts.find((p) => p.type === "decimal")?.value ?? ".",
    };
  } catch {
    // RangeError on a malformed locale tag — keep the English pair.
  }
  separatorCache.set(locale, result);
  return result;
}

/** Recovers the canonical raw numeric string (always dot-decimal, no grouping) from whatever's
 *  currently in the text box (grouped display + the just-typed edit merged in by the browser).
 *  The locale's decimal character becomes the decimal point and its group character is dropped,
 *  so `1,5` → `1.5` and `1.234,56` → `1234.56` in `id`/`de`, while `1,234.56` → `1234.56` in
 *  `en`. Anything else non-numeric is stripped; a leading "-" is kept; redundant leading zeros
 *  are collapsed; the fractional part is capped at 8 digits. In a `.`-grouped locale a typed
 *  `.` is a group separator, not a decimal point (it has to be, or re-parsing the grouped
 *  display on the next keystroke would be ambiguous). */
export function sanitizeNumericInput(raw: string, locale = "en"): string {
  const { decimal } = localeSeparators(locale);
  const negative = raw.trimStart().startsWith("-");
  // Keep digits and the locale decimal char only (group chars and junk fall away), then
  // normalise the decimal char to a dot.
  let cleaned = "";
  for (const ch of raw) {
    if (ch >= "0" && ch <= "9") cleaned += ch;
    else if (ch === decimal) cleaned += ".";
  }
  const dotIndex = cleaned.indexOf(".");
  let result: string;
  if (dotIndex === -1) {
    result = cleaned.replace(/^0+(?=\d)/, "");
  } else {
    const intPart = cleaned.slice(0, dotIndex).replace(/^0+(?=\d)/, "");
    const decPart = cleaned
      .slice(dotIndex + 1)
      .replace(/\./g, "")
      .slice(0, 8);
    result = `${intPart || "0"}.${decPart}`;
  }
  return negative && result ? `-${result}` : result;
}

/** `"1234.5"` → `"1,234.5"` in `en`, `"1.234,5"` in `id`/`de` (display only — see module doc). */
export function formatGrouped(raw: string | null | undefined, locale = "en"): string {
  if (!raw) return "";
  const { decimal } = localeSeparators(locale);
  const negative = raw.startsWith("-");
  const body = negative ? raw.slice(1) : raw;
  const dotIndex = body.indexOf(".");
  const intPart = dotIndex === -1 ? body : body.slice(0, dotIndex);
  const decPart = dotIndex === -1 ? "" : `${decimal}${body.slice(dotIndex + 1)}`;
  const groupedInt = intPart === "" ? "" : Number(intPart).toLocaleString(locale);
  return `${negative ? "-" : ""}${groupedInt}${decPart}`;
}

/** Number of digit characters in `value` strictly before `caret` — the anchor used to keep
 *  the caret glued to "the same digit" across a reformat (see `caretForDigits`). */
export function digitsBefore(value: string, caret: number): number {
  return value.slice(0, caret).replace(/\D/g, "").length;
}

/** Inverse of `digitsBefore`: the index in `formatted` immediately after its Nth digit. */
export function caretForDigits(formatted: string, digits: number): number {
  if (digits <= 0) return 0;
  let count = 0;
  for (let i = 0; i < formatted.length; i++) {
    if (/\d/.test(formatted[i])) {
      count++;
      if (count === digits) return i + 1;
    }
  }
  return formatted.length;
}
