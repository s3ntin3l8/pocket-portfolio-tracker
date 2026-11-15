import { describe, expect, it } from "vitest";
import { sourceTypesFor } from "@/components/transactions-table/types";
import type { TxRow } from "@/components/transactions-table/types";

const tx = (sourceTypes: string[], source = "manual") =>
  ({ source, sources: sourceTypes.map((sourceType) => ({ sourceType })) }) as unknown as TxRow;

describe("sourceTypesFor", () => {
  it("puts the broker feed before the PDF whatever order the API returned", () => {
    expect(sourceTypesFor(tx(["pdf", "pytr"]))).toEqual(["pytr", "pdf"]);
    expect(sourceTypesFor(tx(["pytr", "pdf"]))).toEqual(["pytr", "pdf"]);
  });

  it("dedupes, ranks files between broker and manual, and keeps unknown types in attach order", () => {
    expect(sourceTypesFor(tx(["manual", "pdf", "pdf", "csv", "ibkr"]))).toEqual([
      "ibkr",
      "csv",
      "pdf",
      "manual",
    ]);
    expect(sourceTypesFor(tx(["zeta", "alpha"]))).toEqual(["zeta", "alpha"]);
  });

  it("falls back to the row's own source when it has no source rows", () => {
    expect(sourceTypesFor(tx([], "csv"))).toEqual(["csv"]);
  });
});
