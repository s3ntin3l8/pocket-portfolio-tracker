import { afterEach, describe, expect, it, vi } from "vitest";
import { setThemeWithTransition } from "../src/lib/use-theme-mode";

const originalMatchMedia = window.matchMedia;

function mockReducedMotion(reduce: boolean) {
  window.matchMedia = ((q: string) => ({
    matches: reduce && q.includes("prefers-reduced-motion"),
    media: q,
    addEventListener: () => {},
    removeEventListener: () => {},
  })) as unknown as typeof window.matchMedia;
}

afterEach(() => {
  window.matchMedia = originalMatchMedia;
  // @ts-expect-error test cleanup of the optional API
  delete document.startViewTransition;
});

describe("setThemeWithTransition", () => {
  it("swaps instantly when the View Transitions API is unavailable", () => {
    mockReducedMotion(false);
    const set = vi.fn();
    setThemeWithTransition(set, "dark");
    expect(set).toHaveBeenCalledWith("dark");
  });

  it("applies the theme inside the transition callback so the after-frame is captured", () => {
    mockReducedMotion(false);
    const set = vi.fn();
    const start = vi.fn((cb: () => void) => cb());
    document.startViewTransition = start as unknown as typeof document.startViewTransition;
    setThemeWithTransition(set, "light");
    expect(start).toHaveBeenCalledTimes(1);
    expect(set).toHaveBeenCalledWith("light");
  });

  it("skips the transition under prefers-reduced-motion", () => {
    mockReducedMotion(true);
    const set = vi.fn();
    const start = vi.fn();
    document.startViewTransition = start as unknown as typeof document.startViewTransition;
    setThemeWithTransition(set, "dark");
    expect(start).not.toHaveBeenCalled();
    expect(set).toHaveBeenCalledWith("dark");
  });
});
