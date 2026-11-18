"use client";

import { useEffect, useLayoutEffect, useRef } from "react";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import {
  AssistantHeaderActions,
  AssistantPanel,
  type AssistantPanelState,
} from "@/components/assistant/assistant-panel";

/**
 * The desktop container: a right-hand sidebar, not a modal, so the page stays readable and
 * interactive beside it. In the shell's flex row from `xl:` (the page keeps >= ~640px); between
 * `md:` and `xl:` the same element floats over the page's right edge with no scrim. The wide size
 * is offered only from `2xl:`.
 */
export function AssistantDock({
  state,
  onClose,
  wide,
  onToggleWide,
}: {
  state: AssistantPanelState;
  onClose: () => void;
  wide: boolean;
  onToggleWide: () => void;
}) {
  const t = useTranslations("Assistant");
  const { inputRef } = state;
  const openerRef = useRef<HTMLElement | null>(null);

  // Layout effect: runs before focus moves, so it still sees what opened us. A control inside a
  // dialog that is animating out (a hand-off from Add transaction) is about to be removed, so it
  // is not worth returning to.
  useLayoutEffect(() => {
    const active = document.activeElement;
    const usable =
      active instanceof HTMLElement &&
      active !== document.body &&
      !active.closest('[data-state="closed"]');
    openerRef.current = usable ? active : null;
  }, []);

  // Open: start typing right away. Close: hand focus back to what opened it.
  useEffect(() => {
    inputRef.current?.focus();
    const opener = openerRef;
    return () => {
      // Back to what opened us, else to the top-bar button: never to <body>.
      const el = opener.current?.isConnected
        ? opener.current
        : document.querySelector<HTMLElement>("[data-assistant-trigger]");
      el?.focus();
    };
  }, [inputRef]);

  // Esc closes the dock wherever focus is: the page stays interactive beside it. An overlay that
  // is open on top (a dialog, a menu, the command palette) takes the key for itself first.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      if (document.querySelector('[role="dialog"], [role="menu"], [role="listbox"]')) return;
      onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  return (
    <aside
      aria-label={t("title")}
      className={cn(
        "material-chrome z-40 hidden shrink-0 flex-col border-l border-border bg-card md:flex",
        "max-xl:fixed max-xl:inset-y-0 max-xl:right-0 max-xl:shadow-modal",
        wide ? "w-[400px] 2xl:w-[640px]" : "w-[400px]",
        "max-w-full",
      )}
    >
      <header className="flex min-h-[62px] shrink-0 items-center justify-between gap-2 border-b border-border px-4 md:px-5">
        <h2 className="text-lg font-semibold">{t("title")}</h2>
        <AssistantHeaderActions
          state={state}
          onClose={onClose}
          expand={{ wide, onToggle: onToggleWide }}
        />
      </header>
      <AssistantPanel state={state} />
    </aside>
  );
}
