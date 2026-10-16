import { describe, expect, it } from "vitest";
import { cn } from "../src/lib/utils";

describe("cn with the named type/radius scale", () => {
  it("keeps a named size next to a text colour", () => {
    expect(cn("text-micro", "text-text-2")).toBe("text-micro text-text-2");
    expect(cn("text-body-sm text-foreground")).toContain("text-body-sm");
  });
  it("lets a later size override an earlier one", () => {
    expect(cn("text-micro", "text-body-sm")).toBe("text-body-sm");
    expect(cn("text-xs", "text-hero")).toBe("text-hero");
  });
  it("dedupes radius steps including xs", () => {
    expect(cn("rounded-xs", "rounded-xl")).toBe("rounded-xl");
  });
  it("lets a later tracking step override the label token", () => {
    expect(cn("tracking-label", "tracking-tight")).toBe("tracking-tight");
  });
});
