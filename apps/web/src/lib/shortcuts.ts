import { COMMAND_PAGES } from "@/components/nav-items";

/** How long the `g` prefix stays armed waiting for its second key. */
export const CHORD_TIMEOUT_MS = 1500;

/** `g <key>` → destination, derived from the nav definitions so the two never drift. */
export const GO_CHORDS: Readonly<Record<string, string>> = Object.fromEntries(
  COMMAND_PAGES.filter((p) => p.chord && !p.adminOnly).map((p) => [p.chord as string, p.href]),
);

/**
 * True when keystrokes belong to the focused element rather than to app shortcuts: form
 * fields, contenteditable regions and ARIA text widgets (textbox / combobox / searchbox).
 */
export function isTypingContext(el: Element | null | undefined): boolean {
  if (!el) return false;
  const tag = el.tagName.toUpperCase();
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  if (el instanceof HTMLElement && el.isContentEditable) return true;
  const ce = el.getAttribute("contenteditable");
  if (ce === "" || ce === "true" || ce === "plaintext-only") return true;
  const role = el.getAttribute("role");
  return role === "textbox" || role === "combobox" || role === "searchbox";
}

/** True while a dialog, alert dialog or open menu/listbox is on screen. */
export function isOverlayOpen(doc: Document = document): boolean {
  return (
    doc.querySelector('[role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"]') !==
    null
  );
}

/** Single-key shortcuts only fire from the plain page — never while typing or in an overlay. */
export function shouldIgnoreShortcut(e: KeyboardEvent): boolean {
  if (e.defaultPrevented || e.isComposing || e.repeat) return true;
  if (e.ctrlKey || e.metaKey || e.altKey) return true;
  const target = e.target instanceof Element ? e.target : null;
  return isTypingContext(target) || isTypingContext(document.activeElement) || isOverlayOpen();
}
