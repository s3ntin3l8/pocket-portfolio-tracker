import { describe, it, expect } from "vitest";
import {
  parserToTxSource,
  classifyMatchBySource,
  classifyMatchByParser,
  actionClass,
  findCrossSourceDuplicates,
} from "../../../src/services/parsers/dedup.js";

describe("parserToTxSource", () => {
  it("maps pytr to pytr", () => {
    expect(parserToTxSource("pytr")).toBe("pytr");
  });

  it("maps csv parsers to csv", () => {
    expect(parserToTxSource("csv")).toBe("csv");
    expect(parserToTxSource("dkb")).toBe("csv");
    expect(parserToTxSource("tr-csv")).toBe("csv");
  });

  it("maps deterministic PDF parsers to pdf", () => {
    expect(parserToTxSource("dkb-pdf")).toBe("pdf");
    expect(parserToTxSource("tr-pdf")).toBe("pdf");
  });

  it("maps screenshot and unknown parsers to screenshot", () => {
    expect(parserToTxSource("screenshot")).toBe("screenshot");
    expect(parserToTxSource("mock")).toBe("screenshot");
    expect(parserToTxSource("")).toBe("screenshot");
  });
});

describe("classifyMatchBySource — compares two transactions.source values", () => {
  it("same source → duplicate, even when the import carries a document", () => {
    expect(classifyMatchBySource("screenshot", "screenshot", true)).toBe("duplicate");
    expect(classifyMatchBySource("csv", "csv", true)).toBe("duplicate");
    expect(classifyMatchBySource("manual", "manual", true)).toBe("duplicate");
    expect(classifyMatchBySource("pytr", "pytr", true)).toBe("duplicate");
  });

  it("different source with enrichment value → enrichment", () => {
    expect(classifyMatchBySource("screenshot", "csv", true)).toBe("enrichment");
    expect(classifyMatchBySource("csv", "screenshot", true)).toBe("enrichment");
    expect(classifyMatchBySource("pytr", "csv", true)).toBe("enrichment");
  });

  it("different source without enrichment value → duplicate", () => {
    expect(classifyMatchBySource("screenshot", "csv", false)).toBe("duplicate");
    expect(classifyMatchBySource("manual", "csv", false)).toBe("duplicate");
  });

  // Regression guard for the confirm-time misclassification: a PDF import used to be
  // classified as if it were a *screenshot* import (parserToTxSource("pdf") === "screenshot"
  // because "pdf" is not a parser tag), which silently swallowed PDF re-imports and
  // doubled their tax/fees. Comparing sources directly is what fixes it.
  it("pdf vs pdf → duplicate (a PDF re-import is not an enrichment)", () => {
    expect(classifyMatchBySource("pdf", "pdf", true)).toBe("duplicate");
  });

  it("pdf vs screenshot → enrichment (a PDF is richer than a screenshot)", () => {
    expect(classifyMatchBySource("pdf", "screenshot", true)).toBe("enrichment");
  });

  it("pdf vs csv → enrichment", () => {
    expect(classifyMatchBySource("pdf", "csv", true)).toBe("enrichment");
  });

  it("manual vs manual → duplicate (an AI-assisted entry is a manual row, not a PDF)", () => {
    expect(classifyMatchBySource("manual", "manual", true)).toBe("duplicate");
  });
});

describe("classifyMatchByParser — converts a raw parser tag first", () => {
  it("screenshot import vs csv tx with enrichment value → enrichment", () => {
    expect(classifyMatchByParser("screenshot", "csv", true)).toBe("enrichment");
  });

  it("screenshot import vs screenshot tx (same source) → duplicate", () => {
    expect(classifyMatchByParser("screenshot", "screenshot", true)).toBe("duplicate");
  });

  it("screenshot import vs csv tx but no enrichment value → duplicate", () => {
    expect(classifyMatchByParser("screenshot", "csv", false)).toBe("duplicate");
  });

  it("csv import vs screenshot tx with enrichment → enrichment", () => {
    expect(classifyMatchByParser("csv", "screenshot", true)).toBe("enrichment");
  });

  it("pytr import vs csv tx with enrichment → enrichment (pytr ≠ csv)", () => {
    expect(classifyMatchByParser("pytr", "csv", true)).toBe("enrichment");
  });

  it("csv import vs csv tx → duplicate (same source)", () => {
    expect(classifyMatchByParser("csv", "csv", true)).toBe("duplicate");
  });

  it("dkb import vs csv tx → duplicate (dkb maps to csv, same source)", () => {
    expect(classifyMatchByParser("dkb", "csv", true)).toBe("duplicate");
  });

  it("unknown parser vs csv tx with enrichment → enrichment (unknown maps to screenshot)", () => {
    expect(classifyMatchByParser("vision-fallback", "csv", true)).toBe("enrichment");
  });

  it("dkb-pdf import (raw tag) vs csv tx → enrichment (pdf ≠ csv)", () => {
    expect(classifyMatchByParser("dkb-pdf", "csv", true)).toBe("enrichment");
  });

  it("dkb-pdf import vs pdf tx (same source) → duplicate", () => {
    expect(classifyMatchByParser("dkb-pdf", "pdf", true)).toBe("duplicate");
  });

  it("ai import vs manual tx → duplicate (ai maps to manual)", () => {
    expect(classifyMatchByParser("ai", "manual", true)).toBe("duplicate");
  });
});

describe("classifyMatchBySource vs classifyMatchByParser — namespaces must not mix", () => {
  // The bug class this split removes: a *parser tag* and a *transaction source* are
  // different namespaces that look alike. `parserToTxSource("pdf")` is "screenshot"
  // because "pdf" is not a parser tag — feeding a source into the parser-tag function
  // (or a tag into the source function) silently misclassifies.
  it("'pdf' is a transaction source, not a parser tag", () => {
    expect(parserToTxSource("dkb-pdf")).toBe("pdf");
    // …and "pdf" is not a parser tag, so it must never be passed to the parser function.
    expect(parserToTxSource("pdf")).not.toBe("pdf");
  });

  it("the parser-tag and source functions agree when given the same source value", () => {
    for (const source of ["csv", "pytr", "ibkr", "screenshot"]) {
      expect(classifyMatchByParser(source, "csv", true)).toBe(
        classifyMatchBySource(source, "csv", true),
      );
    }
  });

  it("the two functions disagree for exactly the values that caused the bug", () => {
    // Pre-converting a source and feeding it to the parser function is the old bug.
    expect(classifyMatchByParser(parserToTxSource("dkb-pdf"), "pdf", true)).toBe("enrichment");
    // The correct call — comparing the source directly — says duplicate.
    expect(classifyMatchBySource("pdf", "pdf", true)).toBe("duplicate");
  });
});

describe("actionClass — bonus folds into the acquire class", () => {
  it("buy, savings_plan and bonus all share the acquire class", () => {
    expect(actionClass("buy")).toBe("acquire");
    expect(actionClass("savings_plan")).toBe("acquire");
    // A perk-funded buy that one source collapses into a `bonus` must still dedup against
    // the same trade arriving as a plain buy from another source (CSV bonus vs synced buy).
    expect(actionClass("bonus")).toBe("acquire");
    expect(actionClass("sell")).toBe("sell");
  });

  it("dedups a collapsed `bonus` draft against a committed `buy` of the same shares", () => {
    const committed = [
      {
        key: "inst-1",
        action: "buy",
        quantity: "2.7104",
        price: "37.335",
        executedAt: new Date("2025-08-26"),
        externalId: "tr-csv:buy",
      },
    ];
    const drafts = [
      {
        key: "inst-1",
        action: "bonus",
        quantity: "2.7104",
        price: "37.335",
        executedAt: new Date("2025-08-26"),
      },
    ];
    const matches = findCrossSourceDuplicates(drafts, committed);
    expect(matches).toHaveLength(1);
    expect(matches[0].matched.externalId).toBe("tr-csv:buy");
  });
});
