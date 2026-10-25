"use client";

import { useId, useLayoutEffect, useRef } from "react";
import { useLocale } from "next-intl";
import { Input } from "@/components/ui/input";
import { caretForDigits, digitsBefore, formatGrouped, sanitizeNumericInput } from "./number-format";

interface NumberFieldProps extends Omit<
  React.ComponentProps<typeof Input>,
  "value" | "onChange" | "type"
> {
  /** Raw, comma-free value (what's stored in form state / submitted). */
  value: string;
  onValueChange: (raw: string) => void;
  /**
   * The field's validation message — the API's own text. It is rendered under the input
   * and linked to it with `aria-describedby`, and the input is marked `aria-invalid`.
   * A `FormField` around this input owns the message instead; use this prop when the
   * field is not wrapped in one.
   */
  error?: string | null;
}

/** `Input` with live thousands-grouping (quantity/price/fees/tax) — see `number-format.ts`.
 *  Preserves caret position across reformatting so typing into the middle of a long number
 *  doesn't jump the cursor to the end. */
export function NumberField({ value, onValueChange, error, ...props }: NumberFieldProps) {
  const locale = useLocale();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const pendingCaret = useRef<number | null>(null);
  const fallbackId = useId();
  const controlId = props.id ?? fallbackId;
  const messageId = `${controlId}-error`;

  useLayoutEffect(() => {
    if (pendingCaret.current != null && inputRef.current) {
      inputRef.current.setSelectionRange(pendingCaret.current, pendingCaret.current);
      pendingCaret.current = null;
    }
  });

  return (
    <>
      <Input
        // The invalid/description wiring comes first so a `FormField` that owns the
        // message (and clones this element) keeps the last word on it.
        {...(error ? { "aria-invalid": true, "aria-describedby": messageId } : {})}
        {...props}
        ref={inputRef}
        id={controlId}
        inputMode="decimal"
        value={formatGrouped(value, locale)}
        onChange={(e) => {
          const el = e.target;
          const caret = el.selectionStart ?? el.value.length;
          const digits = digitsBefore(el.value, caret);
          const raw = sanitizeNumericInput(el.value, locale);
          pendingCaret.current = caretForDigits(formatGrouped(raw, locale), digits);
          onValueChange(raw);
        }}
      />
      {error && (
        <p id={messageId} className="mt-1 text-xs font-medium text-destructive-strong">
          {error}
        </p>
      )}
    </>
  );
}
