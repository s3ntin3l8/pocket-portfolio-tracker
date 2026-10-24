import { describe, it, expect } from "vitest";
import { parsePagination, paginate, cacheKey } from "../../src/routes/helpers.js";

describe("parsePagination", () => {
  it("defaults to the first page of 25 when no page param is given (audit D5)", () => {
    expect(parsePagination({})).toEqual({ page: 1, pageSize: 25, all: false });
  });

  it("returns the unpaginated marker only for an explicit all=1", () => {
    expect(parsePagination({ all: "1" })).toEqual({ page: 1, pageSize: 0, all: true });
    expect(parsePagination({ all: "true" })).toEqual({ page: 1, pageSize: 0, all: true });
    expect(parsePagination({ all: "0" })).toEqual({ page: 1, pageSize: 25, all: false });
  });

  it("an explicit page wins over all=1", () => {
    expect(parsePagination({ page: "2", all: "1" })).toEqual({ page: 2, pageSize: 25, all: false });
  });

  it("keeps the legacy unpaginated default for a caller that opts in", () => {
    expect(parsePagination({}, { unpaginatedByDefault: true })).toEqual({
      page: 1,
      pageSize: 0,
      all: false,
    });
    expect(parsePagination({ page: "2" }, { unpaginatedByDefault: true })).toEqual({
      page: 2,
      pageSize: 25,
      all: false,
    });
  });

  it("parses page and pageSize from string query params", () => {
    expect(parsePagination({ page: "3", pageSize: "50" })).toEqual({
      page: 3,
      pageSize: 50,
      all: false,
    });
  });

  it("clamps page to at least 1", () => {
    expect(parsePagination({ page: "0" })).toMatchObject({ page: 1, pageSize: 25 });
    expect(parsePagination({ page: "-5" })).toMatchObject({ page: 1, pageSize: 25 });
  });

  it("clamps pageSize to max 100", () => {
    expect(parsePagination({ page: "1", pageSize: "200" })).toMatchObject({
      page: 1,
      pageSize: 100,
    });
    expect(parsePagination({ pageSize: "5000" })).toMatchObject({ page: 1, pageSize: 100 });
  });

  it("defaults pageSize to 25 when absent but page is given", () => {
    expect(parsePagination({ page: "2" })).toMatchObject({ page: 2, pageSize: 25 });
  });

  it("falls back to defaults on NaN input", () => {
    expect(parsePagination({ page: "abc" })).toMatchObject({ page: 1, pageSize: 25 });
    expect(parsePagination({ page: "abc", pageSize: "xyz" })).toMatchObject({
      page: 1,
      pageSize: 25,
    });
  });

  it("treats pageSize 0 as absent due to || fallback", () => {
    expect(parsePagination({ page: "2", pageSize: "0" })).toMatchObject({ page: 2, pageSize: 25 });
  });

  it("clamps negative pageSize to 1", () => {
    expect(parsePagination({ page: "1", pageSize: "-5" })).toMatchObject({ page: 1, pageSize: 1 });
  });
});

describe("paginate", () => {
  it("returns empty object when pageSize ≤ 0 (no pagination)", () => {
    expect(paginate({ page: 1, pageSize: 0, all: true })).toEqual({});
  });

  it("computes limit and offset for page 1", () => {
    expect(paginate({ page: 1, pageSize: 25, all: false })).toEqual({ limit: 25, offset: 0 });
  });

  it("computes limit and offset for page 3", () => {
    expect(paginate({ page: 3, pageSize: 50, all: false })).toEqual({ limit: 50, offset: 100 });
  });
});

describe("cacheKey", () => {
  it("joins parts positionally", () => {
    // Parts are length-prefixed so no combination of values can be mistaken for another.
    expect(cacheKey("a", "b", "c")).toBe("1:a|1:b|1:c");
  });

  it("keeps a slot for null, undefined and empty strings", () => {
    expect(cacheKey("pf1", null, "method", undefined)).toBe("3:pf1|0:|6:method|0:");
    expect(cacheKey("id", "", "range")).toBe("2:id|0:|5:range");
  });

  it("handles numbers", () => {
    expect(cacheKey("page", 1, "size", 25)).toBe("4:page|1:1|4:size|2:25");
  });

  // A raw "|" join was ambiguous: a user-controlled filter value could contain the
  // separator, so two different requests produced the same key and one was served the
  // other's response.
  it("a value containing the separator cannot collide with a different split", () => {
    expect(cacheKey("a", "b|c")).not.toBe(cacheKey("a|b", "c"));
    expect(cacheKey("convertTo=a", "typeFilter=b")).not.toBe(
      cacheKey("convertTo=a|typeFilter", "b"),
    );
  });

  // Audit D4: the three collisions the old filter-then-join produced.
  it("year=2024 and q=2024 no longer share a key", () => {
    const yearKey = cacheKey("transactions", "pf", 1, 25, "", "", "2024", "", "");
    const searchKey = cacheKey("transactions", "pf", 1, 25, "", "", "", "2024", "");
    expect(yearKey).not.toBe(searchKey);
  });

  it("include=X and exclude=X no longer share a key", () => {
    expect(cacheKey("u", "1y", "", "X", "")).not.toBe(cacheKey("u", "1y", "", "", "X"));
  });

  it("an ids-filtered request and a plain one no longer share a key", () => {
    expect(cacheKey("transactions", "pf", 1, 25, "")).not.toBe(
      cacheKey("transactions", "pf", 1, 25, "id-a,id-b"),
    );
  });
});
