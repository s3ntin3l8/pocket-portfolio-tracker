import { describe, it, expect } from "vitest";
import {
  effectiveScopeValue,
  formatScopeParam,
  parseCookieScope,
  parseScopeParam,
  resolveScope,
  scopeToCookieValue,
  withScope,
  pickDefaultPortfolioId,
  qualifyingHolders,
  readSelectedScope,
} from "../src/lib/portfolio-selection";

describe("qualifyingHolders", () => {
  const holders = [
    { id: "h1", name: "Self" },
    { id: "h2", name: "Child" },
    { id: "h3", name: "Other" },
  ];

  it("returns holders owning ≥2 portfolios", () => {
    const portfolios = [
      { accountHolderId: "h1" },
      { accountHolderId: "h1" },
      { accountHolderId: "h2" },
    ];
    expect(qualifyingHolders(portfolios, holders)).toEqual([{ id: "h1", name: "Self" }]);
  });

  it("returns an empty list when no holder owns ≥2 portfolios", () => {
    const portfolios = [{ accountHolderId: "h1" }, { accountHolderId: "h2" }];
    expect(qualifyingHolders(portfolios, holders)).toEqual([]);
  });

  it("ignores portfolios with no accountHolderId", () => {
    const portfolios = [
      { accountHolderId: null },
      { accountHolderId: undefined },
      { accountHolderId: "h3" },
      { accountHolderId: "h3" },
    ];
    expect(qualifyingHolders(portfolios, holders)).toEqual([{ id: "h3", name: "Other" }]);
  });

  it("returns all qualifying holders when multiple qualify", () => {
    const portfolios = [
      { accountHolderId: "h1" },
      { accountHolderId: "h1" },
      { accountHolderId: "h2" },
      { accountHolderId: "h2" },
      { accountHolderId: "h2" },
    ];
    const result = qualifyingHolders(portfolios, holders);
    expect(result.map((h) => h.id).sort()).toEqual(["h1", "h2"]);
  });

  it("returns empty list when there are no portfolios", () => {
    expect(qualifyingHolders([], holders)).toEqual([]);
  });

  it("returns empty list when there are no holders", () => {
    const portfolios = [{ accountHolderId: "h1" }, { accountHolderId: "h1" }];
    expect(qualifyingHolders(portfolios, [])).toEqual([]);
  });
});

describe("readSelectedScope", () => {
  it("reads the pf cookie out of a cookie string", () => {
    expect(readSelectedScope("a=1; pf=p2; b=3")).toBe("p2");
    expect(readSelectedScope("pf=holder%3Ah1")).toBe("holder:h1");
  });
  it("returns null when absent or empty", () => {
    expect(readSelectedScope("")).toBeNull();
    expect(readSelectedScope("other=1")).toBeNull();
    expect(readSelectedScope("pf=")).toBeNull();
  });
});

describe("pickDefaultPortfolioId", () => {
  const pfs = [
    { id: "p1", accountHolderId: "h1" },
    { id: "p2", accountHolderId: "h2" },
    { id: "p3", accountHolderId: "h2" },
  ];
  it("prefers the selected portfolio", () => {
    expect(pickDefaultPortfolioId(pfs, "p3")).toBe("p3");
  });
  it("picks the holder's first portfolio under a holder scope", () => {
    expect(pickDefaultPortfolioId(pfs, "holder:h2")).toBe("p2");
  });
  it("falls back to the first for all / unknown / absent scope", () => {
    expect(pickDefaultPortfolioId(pfs, "all")).toBe("p1");
    expect(pickDefaultPortfolioId(pfs, "gone")).toBe("p1");
    expect(pickDefaultPortfolioId(pfs, "holder:none")).toBe("p1");
    expect(pickDefaultPortfolioId(pfs, null)).toBe("p1");
  });
  it("is empty with no portfolios", () => {
    expect(pickDefaultPortfolioId([], "p1")).toBe("");
  });
});

describe("scope URL param", () => {
  it("parses all | p:<id> | h:<id> and rejects anything else", () => {
    expect(parseScopeParam("all")).toEqual({ kind: "all" });
    expect(parseScopeParam("p:abc-123")).toEqual({ kind: "portfolio", portfolioId: "abc-123" });
    expect(parseScopeParam("h:h_1")).toEqual({ kind: "holder", holderId: "h_1" });
    for (const bad of [
      null,
      undefined,
      "",
      "p:",
      "h:",
      "x:1",
      "p:a b",
      "p:../x",
      "p:<script>",
      "holder:h1",
      "abc",
    ]) {
      expect(parseScopeParam(bad)).toBeNull();
    }
  });

  it("round-trips through formatScopeParam and maps to the cookie encoding", () => {
    for (const v of ["all", "p:p1", "h:h1"]) {
      expect(formatScopeParam(parseScopeParam(v)!)).toBe(v);
    }
    expect(scopeToCookieValue({ kind: "portfolio", portfolioId: "p1" })).toBe("p1");
    expect(scopeToCookieValue({ kind: "holder", holderId: "h1" })).toBe("holder:h1");
    expect(scopeToCookieValue({ kind: "all" })).toBe("all");
    expect(parseCookieScope("holder:h1")).toEqual({ kind: "holder", holderId: "h1" });
    expect(parseCookieScope(undefined)).toEqual({ kind: "all" });
  });
});

describe("resolveScope precedence", () => {
  it("prefers a valid param over the cookie", () => {
    expect(resolveScope({ param: "p:p2", cookie: "p1" })).toEqual({
      kind: "portfolio",
      portfolioId: "p2",
    });
    // An explicit ?scope=all overrides a portfolio cookie.
    expect(resolveScope({ param: "all", cookie: "p1" })).toEqual({ kind: "all" });
  });

  it("falls back to the cookie when the param is absent or malformed", () => {
    expect(resolveScope({ param: null, cookie: "holder:h1" })).toEqual({
      kind: "holder",
      holderId: "h1",
    });
    expect(resolveScope({ param: "garbage", cookie: "p1" })).toEqual({
      kind: "portfolio",
      portfolioId: "p1",
    });
  });

  it("defaults to all with neither", () => {
    expect(resolveScope({})).toEqual({ kind: "all" });
  });

  it("effectiveScopeValue gives client code the cookie-encoded winner", () => {
    expect(effectiveScopeValue("h:h1", "pf=p1")).toBe("holder:h1");
    expect(effectiveScopeValue(null, "pf=p1")).toBe("p1");
    expect(effectiveScopeValue(null, "")).toBeNull();
  });
});

describe("withScope", () => {
  it("carries the current scope onto an internal href", () => {
    expect(withScope("/reports", new URLSearchParams("scope=p:p1"))).toBe("/reports?scope=p%3Ap1");
    expect(withScope("/tax?year=2025", "scope=h:h1&range=1m")).toBe("/tax?year=2025&scope=h%3Ah1");
    expect(withScope("/holdings?filter=at-cost#top", new URLSearchParams("scope=all"))).toBe(
      "/holdings?filter=at-cost&scope=all#top",
    );
  });

  it("leaves hrefs alone when there is nothing valid to carry", () => {
    expect(withScope("/reports", new URLSearchParams())).toBe("/reports");
    expect(withScope("/reports", null)).toBe("/reports");
    expect(withScope("/reports", new URLSearchParams("scope=bogus"))).toBe("/reports");
  });

  it("never overrides an explicit scope in the href and skips external hrefs", () => {
    expect(withScope("/holdings?scope=all", "scope=p:p1")).toBe("/holdings?scope=all");
    expect(withScope("https://example.com/x", "scope=p:p1")).toBe("https://example.com/x");
    expect(withScope("//evil.example/x", "scope=p:p1")).toBe("//evil.example/x");
  });
});
