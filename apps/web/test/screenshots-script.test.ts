import { describe, it, expect, vi } from "vitest";
import { hideDevIndicator, settle, DEV_INDICATOR_HIDE_CSS } from "../scripts/screenshots.mjs";

describe("screenshots script — dev indicator", () => {
  it("hides the Next.js dev-tools portal so captures don't ship the 'N' badge", async () => {
    const page = { addStyleTag: vi.fn(async () => undefined) };
    await hideDevIndicator(page);
    expect(page.addStyleTag).toHaveBeenCalledWith({ content: DEV_INDICATOR_HIDE_CSS });
    // `!important`: the overlay sets inline styles on this host, and only an important
    // declaration beats an inline `display`.
    expect(DEV_INDICATOR_HIDE_CSS).toMatch(/nextjs-portal\s*\{\s*display:\s*none\s*!important/);
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

  it("settle() hides the indicator as its last step, after the readiness checks", async () => {
    const calls: string[] = [];
    const page = {
      evaluate: vi.fn(async (arg: unknown) => {
        calls.push("evaluate");
        // fonts.ready, the pending-conditions re-check and the empty-chart count.
        return typeof arg === "string" ? [] : 0;
      }),
      waitForFunction: vi.fn(async () => calls.push("waitForFunction")),
      waitForTimeout: vi.fn(async () => calls.push("waitForTimeout")),
      addStyleTag: vi.fn(async () => calls.push("addStyleTag")),
    };
    await settle(page, { slug: "holdings", minCharts: 0 });
    expect(page.addStyleTag).toHaveBeenCalledWith({ content: DEV_INDICATOR_HIDE_CSS });
    expect(calls.at(-1)).toBe("addStyleTag");
    expect(calls.indexOf("waitForFunction")).toBeLessThan(calls.indexOf("addStyleTag"));
  });
});
