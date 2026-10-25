"use client";

import * as React from "react";
import { useSyncExternalStore } from "react";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

/**
 * The published field-level validation messages, keyed by the id of the control they
 * belong to.
 *
 * The API answers an invalid write with a pathed issue list (`validation_error`); the
 * transaction form maps those paths onto the ids of its controls and publishes them here,
 * and every `FormField` renders the message registered for its own id. The map lives in a
 * tiny external store (rather than in React context) because the controls sit several
 * layers below the form element and their props are built by shared components — a
 * provider would have to be mounted above them, next to the form.
 *
 * One map is shared by the app: the transaction form is a modal, so only one instance is
 * mounted at a time, and the map is cleared when that form unmounts.
 */
let published: Readonly<Record<string, string>> = {};
const subscribers = new Set<() => void>();

/**
 * The control that should take the focus after a failed submit — the first field the
 * user has to fix. It is set when the messages are published and stays put while the user
 * works through them: a message that is dropped (the field was edited) must not move the
 * focus to the next field while the user is still typing in the first one.
 */
let focusTarget: string | null = null;

/** Publish the field-level messages of the form that is currently mounted. */
export function publishFieldErrors(errors: Readonly<Record<string, string>>): void {
  published = errors;
  focusTarget = Object.keys(errors)[0] ?? null;
  for (const notify of [...subscribers]) notify();
}

/** Drop the message published for one field (the user is fixing it). */
export function clearFieldError(id: string): void {
  if (!(id in published)) return;
  const next = { ...published };
  delete next[id];
  published = next;
  // The focus target stays where it is — see `focusTarget`.
  for (const notify of [...subscribers]) notify();
}

/** Drop every published message (a successful submit, or an unmounted form). */
export function clearFieldErrors(): void {
  published = {};
  focusTarget = null;
  for (const notify of [...subscribers]) notify();
}

/** The message published for one control id, if any. */
export function useFieldError(id: string): string | undefined {
  // The subscribe function is module-scoped on purpose: an inline one would make React
  // unsubscribe and resubscribe every control on every render.
  return useSyncExternalStore(
    subscribe,
    () => published[id],
    () => undefined,
  );
}

/**
 * Whether this control is the one that takes the focus after a failed submit.
 *
 * A failed submit leaves the focus on the button that was pressed; without this, a
 * screen-reader user is never told that the submit failed.
 */
export function useIsFocusTarget(id: string): boolean {
  return useSyncExternalStore(
    subscribe,
    () => focusTarget === id,
    () => false,
  );
}

/** Subscribe to the published field errors. Stable for the app's lifetime. */
function subscribe(onChange: () => void): () => void {
  subscribers.add(onChange);
  return () => {
    subscribers.delete(onChange);
  };
}

/**
 * Clone the control so it carries the invalid/description wiring: `aria-invalid` marks it
 * as failed and `aria-describedby` points at the message rendered below it. A control
 * that already carries a description keeps it (both are announced).
 */
function withInvalidState(children: React.ReactNode, messageId: string): React.ReactNode {
  const list = Array.isArray(children) ? children : [children];
  let cloned = false;
  const next = list.map((child) => {
    if (cloned || !React.isValidElement(child)) return child;
    cloned = true;
    const existing = (child.props as { "aria-describedby"?: unknown })["aria-describedby"];
    return React.cloneElement(child as React.ReactElement<Record<string, unknown>>, {
      "aria-invalid": true,
      "aria-describedby": typeof existing === "string" ? `${existing} ${messageId}` : messageId,
    });
  });
  return Array.isArray(children) ? next : next[0];
}

/**
 * The control a field's message belongs to: the first focusable control inside the
 * field. A composite control (the date picker's button) is the one the user can reach,
 * so it wins over the hidden input behind it.
 */
const FOCUSABLE_CONTROL =
  'input:not([type="hidden"]):not([disabled]), select:not([disabled]), textarea:not([disabled]), button:not([disabled])';

export function FormField({
  id,
  label,
  children,
  className,
}: {
  /** The id of the control inside `children` — the label is bound to it. */
  id: string;
  label: string;
  children: React.ReactNode;
  className?: string;
}) {
  // The message is the one published for this field's id — see `publishFieldErrors`.
  // There is exactly one channel: a second, prop-based one would be a path nothing
  // publishes to.
  const message = useFieldError(id) ?? null;
  const isFocusTarget = useIsFocusTarget(id);
  const messageId = `${id}-error`;
  const fieldRef = React.useRef<HTMLDivElement>(null);

  // A failed submit leaves the focus on the submit button. Move it to the first field
  // that has to be fixed, so the failure is not silent for a keyboard or screen-reader
  // user — the message is announced (it is a live region) and the control is reached.
  React.useEffect(() => {
    if (!message || !isFocusTarget) return;
    const control = fieldRef.current?.querySelector<HTMLElement>(FOCUSABLE_CONTROL);
    control?.focus();
  }, [id, message, isFocusTarget]);

  return (
    <div ref={fieldRef} className={cn("space-y-1.5", className)}>
      <Label htmlFor={id}>{label}</Label>
      {message ? withInvalidState(children, messageId) : children}
      {message && (
        // A live region: the message is announced when it appears, which is what makes
        // a field-level failure perceivable now that the generic banner is suppressed.
        <p id={messageId} role="alert" className="text-xs font-medium text-destructive-strong">
          {message}
        </p>
      )}
    </div>
  );
}
