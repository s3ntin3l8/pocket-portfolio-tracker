import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { choiceCardClass } from "../src/components/onboarding/choice-card";

const ROOT = join(__dirname, "../src/components/onboarding");

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? sources(p) : [p];
  });
}

describe("onboarding sits on the design system", () => {
  const files = sources(ROOT);

  it("has no CSS module", () => {
    expect(files.filter((f) => f.endsWith(".css"))).toEqual([]);
  });

  it("has no hex / rgba colour literals or inline styles in its components", () => {
    const offenders = files
      .filter((f) => /\.tsx?$/.test(f))
      .filter((f) => /#[0-9a-fA-F]{3,8}\b|rgba?\(|style=\{\{/.test(readFileSync(f, "utf8")));
    expect(offenders).toEqual([]);
  });
});

describe("choiceCardClass", () => {
  it("highlights the selected card with the primary border", () => {
    expect(choiceCardClass(true)).toContain("border-primary");
    expect(choiceCardClass(true)).not.toContain("border-border");
  });

  it("uses the neutral border when unselected", () => {
    expect(choiceCardClass(false)).toContain("border-border");
    expect(choiceCardClass(false)).not.toContain("border-primary");
  });
});
