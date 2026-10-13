import { describe, it, expect, vi, beforeEach } from "vitest";
import { render } from "@testing-library/react";

const replace = vi.fn();
vi.mock("@/i18n/navigation", () => ({
  useRouter: () => ({ replace }),
  usePathname: () => "/holdings",
}));

import {
  LAST_VISITED_KEY,
  RESTORE_TRIED_KEY,
  isRestorablePath,
  readLastVisited,
  recordLastVisited,
} from "../src/lib/last-visited";
import { PwaRestore } from "../src/components/pwa-restore";

describe("isRestorablePath", () => {
  it("accepts same-origin (app) paths with a query", () => {
    for (const ok of [
      "/holdings",
      "/holdings?scope=p%3Ap1&range=1m",
      "/reports/documents",
      "/instruments/abc-123?scope=all",
      "/tax?year=2025",
      "/settings/portfolios",
    ]) {
      expect(isRestorablePath(ok)).toBe(true);
    }
  });

  it("rejects other origins, protocol-relative and scheme URLs", () => {
    for (const bad of [
      "https://evil.example/holdings",
      "//evil.example/holdings",
      "javascript:alert(1)",
      "holdings",
      "/\\evil.example",
      "/holdings\n",
    ]) {
      expect(isRestorablePath(bad)).toBe(false);
    }
  });

  it("rejects non-(app) routes, dot segments and one-shot action params", () => {
    for (const bad of [
      "/",
      "/onboarding",
      "/auth-error",
      "/offline",
      "/api/auth/signout",
      "/admin/users-not-allowed/../x",
      "/holdings/../onboarding",
      "/transactions?shared=1",
      "/transactions?entry=corporate-action",
      "/tax?harvestInstrument=i1",
    ]) {
      expect(isRestorablePath(bad)).toBe(false);
    }
    expect(isRestorablePath(null)).toBe(false);
    expect(isRestorablePath(42)).toBe(false);
    expect(isRestorablePath("/holdings?" + "a".repeat(3000))).toBe(false);
  });
});

describe("record / read", () => {
  beforeEach(() => localStorage.clear());

  it("stores path + search and reads it back", () => {
    recordLastVisited("/tax", "?year=2025&scope=all");
    expect(localStorage.getItem(LAST_VISITED_KEY)).toBe("/tax?year=2025&scope=all");
    expect(readLastVisited()).toBe("/tax?year=2025&scope=all");
    recordLastVisited("/income", "year=2024");
    expect(readLastVisited()).toBe("/income?year=2024");
  });

  it("does not store non-restorable routes, and re-validates what it reads", () => {
    recordLastVisited("/onboarding", "");
    expect(localStorage.getItem(LAST_VISITED_KEY)).toBeNull();
    localStorage.setItem(LAST_VISITED_KEY, "https://evil.example/");
    expect(readLastVisited()).toBeNull();
  });
});

describe("PwaRestore", () => {
  function standalone(on: boolean) {
    window.matchMedia = ((q: string) => ({
      matches: on && q.includes("standalone"),
      media: q,
      addEventListener() {},
      removeEventListener() {},
      addListener() {},
      removeListener() {},
      onchange: null,
      dispatchEvent: () => false,
    })) as unknown as typeof window.matchMedia;
  }

  beforeEach(() => {
    replace.mockClear();
    localStorage.clear();
    sessionStorage.clear();
  });

  it("restores the last URL on a standalone launch", () => {
    standalone(true);
    localStorage.setItem(LAST_VISITED_KEY, "/tax?year=2025&scope=p%3Ap1");
    render(<PwaRestore />);
    expect(replace).toHaveBeenCalledWith("/tax?year=2025&scope=p%3Ap1");
  });

  it("does nothing in a regular browser tab", () => {
    standalone(false);
    localStorage.setItem(LAST_VISITED_KEY, "/tax");
    render(<PwaRestore />);
    expect(replace).not.toHaveBeenCalled();
  });

  it("does nothing without a stored URL and restores at most once per session", () => {
    standalone(true);
    render(<PwaRestore />);
    expect(replace).not.toHaveBeenCalled();
    sessionStorage.removeItem(RESTORE_TRIED_KEY);
    localStorage.setItem(LAST_VISITED_KEY, "/insights");
    const first = render(<PwaRestore />);
    expect(replace).toHaveBeenCalledTimes(1);
    first.unmount();
    render(<PwaRestore />); // e.g. bounced back to `/` by an expired session
    expect(replace).toHaveBeenCalledTimes(1);
  });
});
