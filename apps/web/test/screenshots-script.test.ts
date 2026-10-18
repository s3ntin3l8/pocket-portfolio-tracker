import { describe, it, expect, vi } from "vitest";
import { hideDevIndicator, DEV_INDICATOR_HIDE_CSS } from "../scripts/screenshots.mjs";

describe("screenshots script — dev indicator", () => {
  it("hides the Next.js dev-tools portal so captures don't ship the 'N' badge", async () => {
    const page = { addStyleTag: vi.fn(async () => undefined) };
    await hideDevIndicator(page);
    expect(page.addStyleTag).toHaveBeenCalledWith({ content: DEV_INDICATOR_HIDE_CSS });
    expect(DEV_INDICATOR_HIDE_CSS).toMatch(/nextjs-portal\s*\{\s*display:\s*none/);
  });

  it("the CSS actually hides a <nextjs-portal> element", () => {
    const style = document.createElement("style");
    style.textContent = DEV_INDICATOR_HIDE_CSS;
    document.head.appendChild(style);
    const portal = document.createElement("nextjs-portal");
    document.body.appendChild(portal);
    expect(getComputedStyle(portal).display).toBe("none");
    portal.remove();
    style.remove();
  });
});
