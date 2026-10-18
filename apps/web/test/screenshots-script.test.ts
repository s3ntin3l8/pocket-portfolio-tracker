import { describe, it, expect, vi } from "vitest";
import {
  hideDevIndicator,
  settle,
  devOverlayHasIssues,
  DEV_INDICATOR_HIDE_CSS,
} from "../scripts/screenshots.mjs";

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
    // The overlay sets inline styles on its host; the important rule must still win.
    portal.style.display = "block";
    expect(portal.getAttribute("style")).toContain("display: block");
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

  /** A stub Playwright page: `evaluate` answers by what is being evaluated. */
  function stubPage(over: { pending?: string[]; issues?: boolean; settleFails?: boolean } = {}) {
    const calls: string[] = [];
    const page = {
      evaluate: vi.fn(async (arg: unknown) => {
        calls.push("evaluate");
        if (typeof arg === "string") return over.pending ?? []; // the pending-conditions check
        if (arg === devOverlayHasIssues) return over.issues ?? false;
        return 0; // fonts.ready / the empty-chart count
      }),
      waitForFunction: vi.fn(async () => {
        calls.push("waitForFunction");
        if (over.settleFails) throw new Error("Timeout 60000ms exceeded");
      }),
      waitForTimeout: vi.fn(async () => calls.push("waitForTimeout")),
      addStyleTag: vi.fn(async () => calls.push("addStyleTag")),
    };
    return { page, calls };
  }

  it("settle() throws naming the unmet condition when the page never settles", async () => {
    const { page } = stubPage({ settleFails: true, pending: ["1/2 expected charts drawn"] });
    await expect(settle(page, { slug: "insights", minCharts: 2 })).rejects.toThrow(
      /insights: page did not settle within 60 s \(1\/2 expected charts drawn\)/,
    );
    expect(page.addStyleTag).not.toHaveBeenCalled();
  });

  it("settle() refuses to hide the overlay while it reports a page issue", async () => {
    const { page } = stubPage({ issues: true });
    await expect(settle(page, { slug: "tax" })).rejects.toThrow(
      /tax: the Next dev overlay reports an issue/,
    );
    expect(page.addStyleTag).not.toHaveBeenCalled();
  });

  it("devOverlayHasIssues reads the issues pill in the portal's shadow root", () => {
    const portal = document.createElement("nextjs-portal");
    const root = portal.attachShadow({ mode: "open" });
    document.body.appendChild(portal);
    root.innerHTML = "<div>No issues</div>";
    expect(devOverlayHasIssues()).toBe(false);
    root.innerHTML = '<div data-issues="true"><button>1 Issue</button></div>';
    expect(devOverlayHasIssues()).toBe(true);
    // The selector, not the label, drives the verdict: the insights-only pill counts too.
    root.innerHTML = '<div data-issues="true"><button>1 Insight</button></div>';
    expect(devOverlayHasIssues()).toBe(true);
    root.innerHTML = "<div>Issues 2</div>";
    expect(devOverlayHasIssues()).toBe(true);
    portal.remove();
    expect(devOverlayHasIssues()).toBe(false);
  });
});
