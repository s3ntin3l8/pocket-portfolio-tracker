import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

/**
 * Audit D11 regression guard. `AppShell` mounts on every route, so anything it reaches
 * through a STATIC import ships in every route's first-load JS. Heavy bodies (import flow,
 * manual-entry forms, portfolio/holder forms, Recharts charts) must be reached only via
 * `next/dynamic` (`add-transaction-menu/lazy-bodies.tsx`, `charts/lazy.tsx`). jsdom unit
 * tests can't see bundle composition, so this pins the module boundary at the source level.
 */
const src = path.resolve(__dirname, "../src");

function walk(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    const p = path.join(dir, e);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(e)) out.push(p);
  }
  return out;
}

/** Specifiers imported at runtime (excludes `import type` and `export type`). */
function staticImports(file: string): string[] {
  const text = readFileSync(file, "utf8");
  const found: string[] = [];
  for (const m of text.matchAll(
    /^(?:import|export)\s+(?!type\b)[^;]*?from\s+["']([^"']+)["']/gms,
  )) {
    found.push(m[1]);
  }
  return found;
}

const rel = (f: string) => path.relative(src, f);

describe("code-splitting boundaries (audit D11)", () => {
  it("the add-entry menu reaches its heavy bodies only through lazy-bodies", () => {
    const imports = staticImports(path.join(src, "components/add-transaction-menu.tsx"));
    for (const heavy of [
      "@/components/import-flow-client",
      "@/components/new-entry-tabs",
      "@/components/portfolio-form-dialog/body",
      "@/components/holder-form-dialog/body",
      "@/components/add-transaction-form",
    ]) {
      expect(imports, heavy).not.toContain(heavy);
    }
    expect(imports).toContain("@/components/add-transaction-menu/lazy-bodies");
  });

  it("onboarding reaches the import flow / entry tabs only through lazy-bodies", () => {
    const imports = staticImports(path.join(src, "components/onboarding/onboarding-flow.tsx"));
    expect(imports).not.toContain("@/components/import-flow-client");
    expect(imports).not.toContain("@/components/new-entry-tabs");
  });

  it("AppShell has no static recharts or heavy-flow imports", () => {
    const imports = staticImports(path.join(src, "components/app-shell.tsx"));
    expect(imports).not.toContain("recharts");
    expect(imports.filter((i) => i.startsWith("@/components/charts/"))).toEqual([]);
    for (const heavy of ["import-flow-client", "new-entry-tabs", "add-transaction-form"]) {
      expect(
        imports.filter((i) => i.includes(heavy)),
        heavy,
      ).toEqual([]);
    }
  });

  it("only chart modules and the lazy wrapper import recharts / the heavy chart modules", () => {
    const heavyCharts = [
      "allocation-donut",
      "price-chart",
      "hero-overlay-chart",
      "income-bar-chart",
      "contributions-chart",
      "forecast-chart",
      "revenue-earnings-chart",
      "eps-actual-estimate-chart",
      "yearly-returns-card",
    ];
    const offenders: string[] = [];
    for (const file of walk(src)) {
      const name = rel(file);
      if (
        name.startsWith("components/charts/") ||
        name === "components/insights/yearly-returns-card.tsx"
      )
        continue; // the chart modules themselves (and their siblings) may import recharts
      for (const spec of staticImports(file)) {
        if (spec === "recharts") offenders.push(`${name} -> recharts`);
        if (heavyCharts.some((c) => spec.endsWith(`/${c}`))) offenders.push(`${name} -> ${spec}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("chart modules outside lazy.tsx reach heavy sibling charts only through lazy.tsx", () => {
    // e.g. net-worth-history-chart / contributions-chart -> price-chart, allocation-tabs -> allocation-donut.
    const dir = path.join(src, "components/charts");
    for (const f of readdirSync(dir).filter((n) => /\.tsx?$/.test(n) && n !== "lazy.tsx")) {
      const imports = staticImports(path.join(dir, f)).filter((i) => !i.endsWith("-legend"));
      expect(
        imports.filter((i) =>
          [
            "price-chart",
            "hero-overlay-chart",
            "allocation-donut",
            "income-bar-chart",
            "forecast-chart",
          ].some((c) => i.endsWith(`/${c}`)),
        ),
        f,
      ).toEqual([]);
    }
  });
});
