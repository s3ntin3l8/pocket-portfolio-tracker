import { describe, expect, it } from "vitest";
import { parserToSourceType } from "@/lib/source-style";

describe("parserToSourceType", () => {
  it("mirrors the API's parser → transaction-source mapping", () => {
    expect(parserToSourceType("csv")).toBe("csv");
    expect(parserToSourceType("dkb")).toBe("csv");
    expect(parserToSourceType("tr-csv")).toBe("csv");
    expect(parserToSourceType("dkb-pdf")).toBe("pdf");
    expect(parserToSourceType("tr-pdf")).toBe("pdf");
    expect(parserToSourceType("pytr")).toBe("pytr");
    expect(parserToSourceType("ibkr")).toBe("ibkr");
    expect(parserToSourceType("claude")).toBe("screenshot");
  });

  it("shows AI-assisted entry as a manual entry, not a screenshot", () => {
    expect(parserToSourceType("ai")).toBe("manual");
  });
});
