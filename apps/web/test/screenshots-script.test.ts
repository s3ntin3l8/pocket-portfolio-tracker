import { describe, it, expect, vi } from "vitest";
import {
  hideDevIndicator,
  settle,
  devOverlayHasIssues,
  DEV_INDICATOR_HIDE_CSS,
  SCREENS,
  withSettings,
  CHROMIUM_ARGS,
  assertLocalWebUrl,
  hintingWarning,
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

describe("screenshots script — per-screen settings", () => {
  /** A stub Playwright APIRequestContext over an in-memory user + preferences row. */
  function stubRequest(state = { displayCurrency: "IDR", taxRegime: "DE" }, failOn?: string) {
    const calls: string[] = [];
    const request = {
      fetch: vi.fn(async (url: string, opts: { method: string; data?: Record<string, string> }) => {
        const route = new URL(url).pathname;
        calls.push(`${opts.method} ${route}`);
        const status = failOn === `${opts.method} ${route}` ? 500 : 200;
        if (status === 200 && opts.data) Object.assign(state, opts.data);
        const body =
          route === "/api/backend/me"
            ? { displayCurrency: state.displayCurrency }
            : { taxRegime: state.taxRegime };
        return { ok: () => status === 200, status: () => status, json: async () => body };
      }),
    };
    return { request, state, calls };
  }

  it("captures the tax screen in the DE regime with EUR as the display currency", () => {
    const tax = SCREENS.find((s: { slug: string }) => s.slug === "tax");
    expect(tax?.settings).toEqual({ taxRegime: "DE", displayCurrency: "EUR" });
    // Every other screen stays in the demo user's own (IDR) display currency.
    for (const s of SCREENS.filter((s: { slug: string }) => s.slug !== "tax"))
      expect(s.settings).toBeUndefined();
  });

  it("withSettings applies the settings for the capture, then restores the previous ones", async () => {
    const { request, state, calls } = stubRequest();
    let during: unknown;
    await withSettings({ request }, { taxRegime: "DE", displayCurrency: "EUR" }, async () => {
      during = { ...state };
    });
    expect(during).toEqual({ displayCurrency: "EUR", taxRegime: "DE" });
    expect(state).toEqual({ displayCurrency: "IDR", taxRegime: "DE" });
    // Through the same-origin proxy the app's own settings controls use.
    expect(calls).toContain("PATCH /api/backend/me");
    expect(calls).toContain("PUT /api/backend/me/preferences");
  });

  it("withSettings restores the previous settings even when the capture fails", async () => {
    const { request, state } = stubRequest();
    await expect(
      withSettings({ request }, { displayCurrency: "EUR" }, async () => {
        throw new Error("tax: page did not settle");
      }),
    ).rejects.toThrow(/did not settle/);
    expect(state.displayCurrency).toBe("IDR");
  });

  it("withSettings fails the run when a setting can't be applied", async () => {
    const { request } = stubRequest(undefined, "PATCH /api/backend/me");
    const capture = vi.fn();
    await expect(withSettings({ request }, { displayCurrency: "EUR" }, capture)).rejects.toThrow(
      /PATCH \/api\/backend\/me .*500/,
    );
    expect(capture).not.toHaveBeenCalled();
  });

  it("withSettings puts back the settings it already applied when a later one fails", async () => {
    const { request, state } = stubRequest(
      { displayCurrency: "IDR", taxRegime: "ID" },
      "PATCH /api/backend/me",
    );
    const capture = vi.fn();
    await expect(
      withSettings({ request }, { taxRegime: "DE", displayCurrency: "EUR" }, capture),
    ).rejects.toThrow(/PATCH \/api\/backend\/me .*500/);
    expect(capture).not.toHaveBeenCalled();
    expect(state).toEqual({ displayCurrency: "IDR", taxRegime: "ID" });
  });

  it("withSettings fails the run when the API doesn't echo the new value back", async () => {
    const { request } = stubRequest();
    request.fetch.mockImplementation(async () => ({
      ok: () => true,
      status: () => 200,
      json: async () => ({ displayCurrency: "IDR" }),
    }));
    await expect(withSettings({ request }, { displayCurrency: "EUR" }, vi.fn())).rejects.toThrow(
      /displayCurrency to EUR did not stick \(API answered IDR\)/,
    );
  });

  it("withSettings restores every original even when restoring one of them fails", async () => {
    // Restore must write the recorded originals, not re-read the (temporary) current values:
    // otherwise a failed second restore leaves the first key on its temporary value too.
    const state = { displayCurrency: "IDR", taxRegime: "ID" };
    let restoring = false;
    const request = {
      fetch: vi.fn(async (url: string, opts: { method: string; data?: Record<string, string> }) => {
        const route = new URL(url).pathname;
        const fail = restoring && opts.method === "PATCH";
        if (!fail && opts.data) Object.assign(state, opts.data);
        const body =
          route === "/api/backend/me"
            ? { displayCurrency: state.displayCurrency }
            : { taxRegime: state.taxRegime };
        return { ok: () => !fail, status: () => (fail ? 500 : 200), json: async () => body };
      }),
    };
    await expect(
      withSettings({ request }, { taxRegime: "DE", displayCurrency: "EUR" }, async () => {
        restoring = true;
      }),
    ).rejects.toThrow(/could not restore displayCurrency to IDR/);
    expect(state.taxRegime).toBe("ID");
  });

  it("withSettings reports the capture's error and a failed restore together", async () => {
    let restoring = false;
    const state = { displayCurrency: "IDR", taxRegime: "DE" };
    const request = {
      fetch: vi.fn(
        async (_url: string, opts: { method: string; data?: Record<string, string> }) => {
          const fail = restoring && opts.method !== "GET";
          if (!fail && opts.data) Object.assign(state, opts.data);
          return {
            ok: () => !fail,
            status: () => (fail ? 500 : 200),
            json: async () => ({ displayCurrency: state.displayCurrency }),
          };
        },
      ),
    };
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await expect(
      withSettings({ request }, { displayCurrency: "EUR" }, async () => {
        restoring = true;
        throw new Error("tax: page did not settle");
      }),
    ).rejects.toThrow(
      // Both, loudly: the instance is left on the temporary settings, so a later capture
      // against it must not treat them as the originals.
      /tax: page did not settle.*could not restore displayCurrency to IDR/s,
    );
    warn.mockRestore();
  });

  it("withSettings accepts an echo the API coerced (e.g. a number for a numeric string)", async () => {
    const state: Record<string, unknown> = { taxRegime: "DE" };
    const request = {
      fetch: vi.fn(
        async (_url: string, opts: { method: string; data?: Record<string, string> }) => {
          if (opts.data) Object.assign(state, opts.data);
          // Echo a coerced form, as /me/preferences does for numeric fields.
          return { ok: () => true, status: () => 200, json: async () => ({ taxRegime: 1 }) };
        },
      ),
    };
    await expect(withSettings({ request }, { taxRegime: "1" }, async () => 7)).resolves.toBe(7);
  });

  it("withSettings rejects an unknown setting instead of silently capturing without it", async () => {
    const { request } = stubRequest();
    await expect(withSettings({ request }, { locale: "de" }, vi.fn())).rejects.toThrow(
      /unknown screen setting "locale"/,
    );
  });

  it("withSettings is a plain pass-through for a screen without settings", async () => {
    const { request, calls } = stubRequest();
    expect(await withSettings({ request }, undefined, async () => 42)).toBe(42);
    expect(calls).toEqual([]);
  });
});

describe("screenshots script — text rendering", () => {
  it("launches Chromium without font hinting, so 2x captures don't break words apart", () => {
    // Headless Chromium on Linux hints glyphs by default: at the narrow captures' small text
    // sizes the snapped advances read as gaps inside words ("Estimat ed", "Pocke t", "YT D").
    expect(CHROMIUM_ARGS).toContain("--font-render-hinting=none");
  });

  it("warns that the flag only takes effect on Linux", () => {
    expect(hintingWarning("linux")).toBeNull();
    expect(hintingWarning("darwin")).toMatch(/only applies on Linux/);
    expect(hintingWarning("win32")).toMatch(/only applies on Linux/);
  });
});

describe("screenshots script — target guard", () => {
  it("accepts the local demo instance", () => {
    expect(() => assertLocalWebUrl("http://localhost:3915", {})).not.toThrow();
    expect(() => assertLocalWebUrl("http://127.0.0.1:3915", {})).not.toThrow();
  });

  it("refuses a remote host, since it switches the signed-in user's settings", () => {
    expect(() => assertLocalWebUrl("https://pocket.example.com", {})).toThrow(
      /refusing to capture against pocket\.example\.com/,
    );
  });

  it("allows a remote host only when the override names that exact host", () => {
    expect(() =>
      assertLocalWebUrl("https://pocket.example.com", {
        SCREENSHOTS_ALLOW_REMOTE: "pocket.example.com",
      }),
    ).not.toThrow();
    // A stray generic flag (or another host's) must not open every deployment.
    for (const flag of ["1", "true", "staging.example.com"])
      expect(() =>
        assertLocalWebUrl("https://pocket.example.com", { SCREENSHOTS_ALLOW_REMOTE: flag }),
      ).toThrow(/refusing to capture against pocket\.example\.com/);
  });
});
