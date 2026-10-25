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

/** Publish the field-level messages of the form that is currently mounted. */
export function publishFieldErrors(errors: Readonly<Record<string, string>>): void {
  published = errors;
  for (const notify of [...subscribers]) notify();
}

/** Drop the message published for one field (the user is fixing it). */
export function clearFieldError(id: string): void {
  if (!(id in published)) return;
  const next = { ...published };
  delete next[id];
  publishFieldErrors(next);
}

/** Drop every published message (a successful submit, or an unmounted form). */
export function clearFieldErrors(): void {
  publishFieldErrors({});
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
  const messageId = `${id}-error`;

  return (
    <div className={cn("space-y-1.5", className)}>
      <Label htmlFor={id}>{label}</Label>
      {message ? withInvalidState(children, messageId) : children}
      {message && (
        <p id={messageId} className="text-xs font-medium text-destructive-strong">
          {message}
        </p>
      )}
    </div>
  );
}
