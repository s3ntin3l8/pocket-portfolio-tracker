import { describe, it, expect } from "vitest";
import {
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
