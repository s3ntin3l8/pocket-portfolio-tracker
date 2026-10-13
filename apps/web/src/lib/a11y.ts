import type { KeyboardEvent } from "react";

/**
 * `onKeyDown` handler that makes a non-native clickable element (a `div`/`tr` with
 * `tabIndex={0}`) keyboard-activatable: Enter or Space runs `activate`, exactly like a
 * native button. Ignores key events bubbling up from interactive children (a checkbox,
 * an inline action button) so those keep their own keyboard behaviour.
 */
export function onActivateKey(activate: () => void) {
  return (ev: KeyboardEvent<HTMLElement>) => {
    if (ev.target !== ev.currentTarget) return;
    if (ev.key === "Enter" || ev.key === " ") {
      ev.preventDefault();
      activate();
    }
  };
}
