"use client";

import * as React from "react";

/**
 * Focus restoration for Radix dialogs that have no `<Trigger>` (opened by a keyboard
 * shortcut, the command bar, or a state flag). Radix's modal `Dialog.Content` always
 * `preventDefault()`s its close auto-focus and hands focus to `triggerRef` — which is
 * `null` without a trigger, so focus dropped to `<body>` and the next Tab started from
 * the top of the page (found by the command-bar e2e).
 *
 * Remembers the focused element when `open` flips to true and returns an
 * `onCloseAutoFocus` handler to pass to `Dialog.Content`: if that element is still in the
 * document it gets focus back (a trigger, when there is one, is what was focused, so the
 * behaviour is unchanged for triggered dialogs); otherwise Radix's default applies.
 */
export function useRestoreFocus(open: boolean | undefined) {
  const previousRef = React.useRef<HTMLElement | null>(null);
  const wasOpenRef = React.useRef(false);

  // Layout effect: must run before Radix's FocusScope (a passive effect inside the
  // portalled content) moves focus into the dialog.
  React.useLayoutEffect(() => {
    if (open && !wasOpenRef.current) {
      const active = document.activeElement;
      previousRef.current =
        active instanceof HTMLElement && active !== document.body ? active : null;
    }
    wasOpenRef.current = Boolean(open);
  }, [open]);

  return React.useCallback((event: Event) => {
    const el = previousRef.current;
    previousRef.current = null;
    if (el?.isConnected) {
      event.preventDefault();
      el.focus();
    }
  }, []);
}
