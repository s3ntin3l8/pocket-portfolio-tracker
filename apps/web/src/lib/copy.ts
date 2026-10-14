/**
 * Copy text to the clipboard, returning whether it succeeded. The async Clipboard
 * API only exists in a *secure context* (https or localhost); this app is often served
 * over plain HTTP on a LAN IP, where `navigator.clipboard` is undefined — so fall back
 * to a hidden-textarea + `execCommand("copy")`, which still works there.
 */
export async function copyToClipboard(text: string): Promise<boolean> {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // Fall through to the legacy path.
    }
  }
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}
