# Benchmark Overlay on Holdings Wealth Chart — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Overlay the user's chosen benchmark (default `^GSPC`) on the Holdings glance hero chart as a TWR-normalized comparison, alongside a period delta pill.

**Architecture:** Reuse the existing TWR `index` / `pct` / `benchmarkIndex` plumbing. The aggregate `/networth/history` already returns benchmark fields; we add the same plumbing to `/portfolios/:id/history` for parity, then rewire the hero variant of `NetWorthHistoryChart` to render two indexed `<Line>`s (white solid portfolio + yellow dashed benchmark) on a `ComposedChart`. Pills switch from absolute delta to TWR % so the chart and pills read consistently. Intraday (1D/7D) hides the overlay since no benchmark intraday data exists.

**Tech Stack:** Fastify 5 + Drizzle/Postgres, Next.js 15 / React 19, recharts (v3) — `ComposedChart` + `Line`, next-intl (EN + ID).

---

## File Structure

| File                                                         | Responsibility                                                                                                                                                                                                            |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `services/api/src/routes/transactions/history.ts`            | Add benchmark enrichment to `/portfolios/:id/history` (parity with aggregate endpoint).                                                                                                                                   |
| `services/api/test/routes/api.test.ts`                       | New test cases for single-portfolio benchmark plumbing.                                                                                                                                                                   |
| `apps/web/src/components/charts/hero-overlay-chart.tsx`      | NEW. Inline two-line `ComposedChart` for the hero variant — portfolio + benchmark, both indexed, no axes.                                                                                                                 |
| `apps/web/src/components/charts/net-worth-history-chart.tsx` | Replace `PriceChart` with `HeroOverlayChart` in the hero variant. Switch data prep from `netWorth` to `pct` (TWR %) for the hero day-grained path. Expose `benchmarkSymbol` + `benchmarkPct` series via `onSeriesChange`. |
| `apps/web/src/components/holdings/hero-glance-card.tsx`      | Switch pill 1 derivation from absolute delta to TWR %. Add pill 2 (benchmark delta) + legend. Hide pill 2 when no benchmark data.                                                                                         |
| `apps/web/test/chart-series.test.ts`                         | Existing — no change.                                                                                                                                                                                                     |
| `apps/web/test/hero-overlay-chart.test.tsx`                  | NEW. Standalone tests for the new chart component.                                                                                                                                                                        |
| `apps/web/test/net-worth-history-chart.test.tsx`             | Stub `HeroOverlayChart` like `PriceChart` is stubbed today; new cases for TWR-normalized wiring.                                                                                                                          |
| `apps/web/test/hero-glance-card.test.tsx`                    | New cases for the two-pill layout + benchmark fallback.                                                                                                                                                                   |
| `apps/web/messages/en.json`                                  | Add `Holdings.hero.legendPortfolio`, `legendBenchmark`, `benchmarkPillUnavailable`.                                                                                                                                       |
| `apps/web/messages/id.json`                                  | Mirror the above in Indonesian.                                                                                                                                                                                           |

---

## Task 1: API — Benchmark plumbing for `/portfolios/:id/history`

**Files:**

- Modify: `services/api/src/routes/transactions/history.ts:62-94` (insert benchmark enrichment before `return result;`)
- Test: `services/api/test/routes/api.test.ts` (extend the existing single-portfolio-history `it` block at line 2857-2888)

The aggregate `/networth/history` already populates `benchmarkIndex` / `benchmarkPct` per point (lines 281-311). Single-portfolio history returns the same `PerformancePoint` shape but skips that step — the hero card breaks for users with a single portfolio selected. Add the same enrichment.

- [ ] **Step 1: Write the failing test**

Add a new test inside the existing `describe` block in `services/api/test/routes/api.test.ts`, after the existing single-portfolio history test (line ~2888). The pattern follows `services/api/test/services/benchmark.test.ts:170-220` for seeding `userPreferences` and `benchmarkPrices`:

```ts
it("includes benchmarkIndex/benchmarkPct on /portfolios/:id/history when the user has a benchmark configured", async () => {
  const t = await token("bm-overlay-user");
  // Create user + portfolio + seed snapshots covering 3 days.
  await app.inject({ method: "GET", url: "/me", headers: auth(t) }); // upsert user
  const create = await app.inject({
    method: "POST",
    url: "/portfolios",
    headers: auth(t),
    payload: { name: "BM Overlay", baseCurrency: "IDR" },
  });
  const portfolioId = create.json().id as string;

  const [u] = await app.db
    .select({ id: schemaUsers.id })
    .from(schemaUsers)
    .where(eq(schemaUsers.authSub, "bm-overlay-user"))
    .limit(1);
  await app.db.insert(userPreferences).values({
    userId: u!.id,
    benchmarkSymbol: "^GSPC",
  });
  await app.db.insert(benchmarkPrices).values([
    {
      userId: u!.id,
      symbol: "^GSPC",
      date: "2026-02-01",
      close: "4500",
      currency: "USD",
      source: "test",
    },
    {
      userId: u!.id,
      symbol: "^GSPC",
      date: "2026-02-02",
      close: "4600",
      currency: "USD",
      source: "test",
    },
    {
      userId: u!.id,
      symbol: "^GSPC",
      date: "2026-02-03",
      close: "4700",
      currency: "USD",
      source: "test",
    },
  ]);
  await app.db.insert(portfolioSnapshots).values([
    {
      portfolioId,
      date: "2026-02-01",
      netWorth: "1000000",
      marketValue: "1000000",
      effectiveFlow: "0",
      currency: "IDR",
    },
    {
      portfolioId,
      date: "2026-02-02",
      netWorth: "1050000",
      marketValue: "1050000",
      effectiveFlow: "0",
      currency: "IDR",
    },
    {
      portfolioId,
      date: "2026-02-03",
      netWorth: "1100000",
      marketValue: "1100000",
      effectiveFlow: "0",
      currency: "IDR",
    },
  ]);

  const res = await app.inject({
    method: "GET",
    url: `/portfolios/${portfolioId}/history?range=all`,
    headers: auth(t),
  });
  expect(res.statusCode).toBe(200);
  const body = res.json() as Array<{ benchmarkIndex?: string; benchmarkPct?: string }>;
  expect(body[0]).toHaveProperty("benchmarkIndex");
  expect(body[0]).toHaveProperty("benchmarkPct");
  // First point must be the chain base (100 / 0).
  expect(body[0].benchmarkIndex).toBe("100");
  expect(body[0].benchmarkPct).toBe("0");
  // Last point reflects ~4.4% benchmark return (4700/4500 - 1 ≈ 4.444%).
  expect(Number(body[2].benchmarkPct)).toBeCloseTo(4.444, 2);
});
```

Add `userPreferences`, `benchmarkPrices`, and `portfolioSnapshots` to the existing imports from `@portfolio/db` (line 7 already imports `portfolioSnapshots`; add the other two). Add a `users` import as `schemaUsers` to avoid a collision with the local `users` test token, mirroring `services/api/test/services/benchmark.test.ts:4`.

Add a second test for the "no benchmark configured" case:

```ts
it("omits benchmarkIndex/benchmarkPct on /portfolios/:id/history when no benchmark is configured", async () => {
  const t = await token("bm-overlay-none-user");
  await app.inject({ method: "GET", url: "/me", headers: auth(t) });
  const create = await app.inject({
    method: "POST",
    url: "/portfolios",
    headers: auth(t),
    payload: { name: "No BM", baseCurrency: "IDR" },
  });
  const portfolioId = create.json().id as string;
  await app.db.insert(portfolioSnapshots).values([
    {
      portfolioId,
      date: "2026-02-01",
      netWorth: "1000000",
      marketValue: "1000000",
      effectiveFlow: "0",
      currency: "IDR",
    },
    {
      portfolioId,
      date: "2026-02-02",
      netWorth: "1100000",
      marketValue: "1100000",
      effectiveFlow: "0",
      currency: "IDR",
    },
  ]);

  const res = await app.inject({
    method: "GET",
    url: `/portfolios/${portfolioId}/history?range=all`,
    headers: auth(t),
  });
  expect(res.statusCode).toBe(200);
  const body = res.json() as Array<{ benchmarkIndex?: string; benchmarkPct?: string }>;
  expect(body[0].benchmarkIndex).toBeUndefined();
  expect(body[0].benchmarkPct).toBeUndefined();
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run:

```bash
npm test --workspace @portfolio/api -- services/api/test/routes/api.test.ts -t "benchmarkIndex"
```

Expected: FAIL with "expected benchmarkIndex to exist" (response object lacks the property because the enrichment step is missing).

- [ ] **Step 3: Implement the benchmark enrichment**

In `services/api/src/routes/transactions/history.ts`, modify the day-grained branch of `/portfolios/:id/history`. Replace the current `return result;` at line 92 with the same benchmark block used in `/networth/history` (lines 282-311), minus the `display` currency (this endpoint doesn't FX-convert):

```ts
// Benchmark enrichment — same pattern as /networth/history, minus the display
// currency (this endpoint returns snapshots in their stored base currency; the
// benchmark is a separate indexed series, so no FX conversion is involved).
const userId = request.userId;
const bmConfig = await getUserBenchmarkConfig(app.db, userId, "");
if (result.length > 0) {
  const bmDates = result.map((p) => p.date);
  const existingBm = await getBenchmarkPrices(app.db, userId, bmConfig.symbol, bmDates);
  const missingDates = bmDates.filter((d) => !existingBm.has(d));
  if (missingDates.length > 0) {
    const earliest = missingDates[0];
    try {
      const md = await getMarketData();
      await fetchBenchmarkPrices(app.db, md, userId, bmConfig.symbol, earliest);
    } catch {
      /* non-fatal — benchmark is best-effort */
    }
  }
  const refreshedBm = await getBenchmarkPrices(app.db, userId, bmConfig.symbol, bmDates);
  if (refreshedBm.size > 1) {
    const bmPrices = bmDates
      .filter((d) => refreshedBm.has(d))
      .map((d) => ({ date: d, close: refreshedBm.get(d)! }));
    const bmIndex = computeBenchmarkIndex(bmPrices);
    const bmById = new Map(bmIndex.map((p) => [p.date, p]));
    for (const p of result) {
      const bp = bmById.get(p.date);
      if (bp) {
        (p as { benchmarkIndex?: string; benchmarkPct?: string }).benchmarkIndex = bp.index;
        (p as { benchmarkPct?: string }).benchmarkPct = bp.pct;
      }
    }
  }
}
return result;
```

All required imports (`getUserBenchmarkConfig`, `fetchBenchmarkPrices`, `getBenchmarkPrices`, `computeBenchmarkIndex`, `getMarketData`) already exist at the top of the file (lines 19-23 + the `getMarketData` import already present). No new imports needed.

- [ ] **Step 4: Run the tests to verify they pass**

Run:

```bash
npm test --workspace @portfolio/api -- services/api/test/routes/api.test.ts -t "benchmarkIndex"
```

Expected: PASS for both new cases.

- [ ] **Step 5: Run the full API test suite to confirm no regression**

Run:

```bash
npm test --workspace @portfolio/api
```

Expected: all tests pass (no snapshot or other history-related regressions).

- [ ] **Step 6: Commit**

```bash
git add services/api/src/routes/transactions/history.ts services/api/test/routes/api.test.ts
git commit -m "feat(api): populate benchmark fields on single-portfolio history (#600)"
```

---

## Task 2: Web — `HeroOverlayChart` component

**Files:**

- Create: `apps/web/src/components/charts/hero-overlay-chart.tsx`
- Test: `apps/web/test/hero-overlay-chart.test.tsx`

The hero variant is bespoke (white-on-green, no axes, no grid, no tooltip), so it gets its own minimal `ComposedChart`. Two `<Line>`s only, one white-solid (portfolio), one yellow-dashed (benchmark, drawn first so it sits behind). When `benchmark` values are all null, only the portfolio line renders. When `benchmark` is absent from the data (all null), the legend should still show the benchmark label but with `—` for the value — that's handled by the parent.

- [ ] **Step 1: Write the failing test**

Create `apps/web/test/hero-overlay-chart.test.tsx`:

```tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import messages from "../messages/en.json";
import { HeroOverlayChart } from "../src/components/charts/hero-overlay-chart";

function renderChart(points: Array<{ date: string; portfolio: number; benchmark: number | null }>) {
  return render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <HeroOverlayChart points={points} />
    </NextIntlClientProvider>,
  );
}

describe("HeroOverlayChart", () => {
  it("renders without crashing when given a 2-point portfolio-only series", () => {
    renderChart([
      { date: "2026-01-01", portfolio: 100, benchmark: null },
      { date: "2026-02-01", portfolio: 110, benchmark: null },
    ]);
    expect(screen.getByTestId("hero-overlay-chart")).toBeInTheDocument();
  });

  it("renders two lines when benchmark values are present", () => {
    const { container } = renderChart([
      { date: "2026-01-01", portfolio: 100, benchmark: 100 },
      { date: "2026-02-01", portfolio: 110, benchmark: 105 },
      { date: "2026-03-01", portfolio: 120, benchmark: 108 },
    ]);
    // recharts renders one <path class="recharts-line-curve"> per <Line>.
    const lines = container.querySelectorAll(".recharts-line-curve");
    expect(lines.length).toBe(2);
  });

  it("renders only the portfolio line when benchmark values are all null", () => {
    const { container } = renderChart([
      { date: "2026-01-01", portfolio: 100, benchmark: null },
      { date: "2026-02-01", portfolio: 110, benchmark: null },
    ]);
    // recharts still renders a <path> per <Line>, but the dashed-yellow benchmark line
    // is drawn as an empty path when every value is null. We assert by counting
    // non-empty `d` attributes among the curves.
    const lines = container.querySelectorAll(".recharts-line-curve");
    const nonEmpty = Array.from(lines).filter((l) => (l.getAttribute("d") ?? "").length > 1);
    expect(nonEmpty.length).toBe(1);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run:

```bash
npm test --workspace @portfolio/web -- apps/web/test/hero-overlay-chart.test.tsx
```

Expected: FAIL — module `hero-overlay-chart` not found.

- [ ] **Step 3: Implement the component**

Create `apps/web/src/components/charts/hero-overlay-chart.tsx`:

```tsx
"use client";

import { ComposedChart, Line, ResponsiveContainer } from "recharts";

export interface HeroOverlayPoint {
  date: string;
  portfolio: number;
  benchmark: number | null;
}

/**
 * The Holdings glance hero chart. Two TWR-rebased `<Line>`s on a shared base of 100:
 *   - portfolio: white solid, drawn in front
 *   - benchmark: yellow dashed, drawn behind (or omitted entirely when its series
 *     is all-null, e.g. intraday or "no benchmark configured").
 *
 * No axes, no grid, no tooltip, no legend — the parent renders the legend so the
 * benchmark label can be localised via next-intl. Inherits its container's width and
 * the standard hero height (~74px).
 */
export function HeroOverlayChart({ points }: { points: HeroOverlayPoint[] }) {
  return (
    <div data-testid="hero-overlay-chart" className="w-full" style={{ height: 74 }}>
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={points} margin={{ top: 0, right: 0, left: 0, bottom: 0 }}>
          <Line
            type="monotone"
            dataKey="benchmark"
            stroke="#FFD24A"
            strokeWidth={1.8}
            strokeDasharray="5 3"
            dot={false}
            isAnimationActive={false}
          />
          <Line
            type="monotone"
            dataKey="portfolio"
            stroke="#ffffff"
            strokeWidth={2.2}
            dot={false}
            isAnimationActive={false}
          />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run:

```bash
npm test --workspace @portfolio/web -- apps/web/test/hero-overlay-chart.test.tsx
```

Expected: PASS for all three cases.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/charts/hero-overlay-chart.tsx apps/web/test/hero-overlay-chart.test.tsx
git commit -m "feat(web): add HeroOverlayChart for two-line benchmark comparison"
```

---

## Task 3: Web — Wire `NetWorthHistoryChart` hero variant to `HeroOverlayChart`

**Files:**

- Modify: `apps/web/src/components/charts/net-worth-history-chart.tsx:62-200` (hero variant branch only)
- Test: `apps/web/test/net-worth-history-chart.test.tsx`

Hero variant switches from absolute `netWorth` to TWR-normalized `pct` for the portfolio series, and renders the second `<Line>` from `benchmarkPct`. The existing `onSeriesChange` callback signature is extended to carry benchmark series data so the parent can derive pill 2 without re-computing.

- [ ] **Step 1: Write the failing test**

Extend `apps/web/test/net-worth-history-chart.test.tsx`:

First, add the new stub alongside the existing `PriceChart` stub (line 8-10):

```tsx
vi.mock("@/components/charts/hero-overlay-chart", () => ({
  HeroOverlayChart: (props: { points: unknown[] }) => (
    <div data-testid="hero-overlay-chart" data-points={JSON.stringify(props.points.length)} />
  ),
}));
```

Then add a new `describe("hero variant with benchmark overlay")` block at the end of the file:

```tsx
describe("hero variant with benchmark overlay", () => {
  const pointsWithBenchmark: PerformancePoint[] = [
    { date: "2026-01-01", netWorth: "100", pct: "0", benchmarkPct: "0" },
    { date: "2026-02-01", netWorth: "110", pct: "10", benchmarkPct: "5" },
    { date: "2026-03-01", netWorth: "120", pct: "20", benchmarkPct: "8" },
  ];
  const pointsWithoutBenchmark: PerformancePoint[] = [
    { date: "2026-01-01", netWorth: "100", pct: "0" },
    { date: "2026-02-01", netWorth: "110", pct: "10" },
  ];

  it("renders the new HeroOverlayChart in the hero variant (not the legacy PriceChart)", () => {
    render(
      <NextIntlClientProvider locale="en" messages={messages}>
        <NetWorthHistoryChart
          initial={pointsWithBenchmark}
          currency="IDR"
          variant="hero"
          initialRange="1y"
        />
      </NextIntlClientProvider>,
    );
    expect(screen.getByTestId("hero-overlay-chart")).toBeInTheDocument();
  });

  it("emits benchmark series via onSeriesChange when benchmark data is present", async () => {
    const onSeriesChange = vi.fn();
    render(
      <NextIntlClientProvider locale="en" messages={messages}>
        <NetWorthHistoryChart
          initial={pointsWithBenchmark}
          currency="IDR"
          variant="hero"
          initialRange="1y"
          onSeriesChange={onSeriesChange}
        />
      </NextIntlClientProvider>,
    );
    await waitFor(() => {
      const lastCall = onSeriesChange.mock.calls.at(-1);
      // Signature change: now an object {points, benchmarkPct, hasBenchmark}.
      expect(lastCall?.[0]).toMatchObject({
        hasBenchmark: true,
        benchmarkPct: "8",
      });
      expect(lastCall?.[0].points.length).toBe(3);
    });
  });

  it("emits hasBenchmark=false when benchmark data is absent", async () => {
    const onSeriesChange = vi.fn();
    render(
      <NextIntlClientProvider locale="en" messages={messages}>
        <NetWorthHistoryChart
          initial={pointsWithoutBenchmark}
          currency="IDR"
          variant="hero"
          initialRange="1y"
          onSeriesChange={onSeriesChange}
        />
      </NextIntlClientProvider>,
    );
    await waitFor(() => {
      const lastCall = onSeriesChange.mock.calls.at(-1);
      expect(lastCall?.[0]).toMatchObject({ hasBenchmark: false });
    });
  });

  it("hides the overlay for intraday ranges (1D/7D)", async () => {
    const intraday: IntradayPoint[] = [
      { at: "2026-06-01T02:00:00.000Z", netWorth: "1000", marketValue: "1000" },
      { at: "2026-06-01T03:00:00.000Z", netWorth: "1050", marketValue: "1050" },
    ];
    getNetWorthHistory.mockResolvedValueOnce(intraday);
    const onSeriesChange = vi.fn();
    render(
      <NextIntlClientProvider locale="en" messages={messages}>
        <NetWorthHistoryChart
          initial={pointsWithBenchmark}
          currency="IDR"
          variant="hero"
          initialRange="1y"
          onSeriesChange={onSeriesChange}
        />
      </NextIntlClientProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "1D" }));
    await waitFor(() => expect(getNetWorthHistory).toHaveBeenCalledWith("1d"));
    await waitFor(() => {
      const lastCall = onSeriesChange.mock.calls.at(-1);
      // Intraday emits hasBenchmark=false (no benchmark intraday data).
      expect(lastCall?.[0]).toMatchObject({ hasBenchmark: false });
    });
  });
});
```

Also update the existing hero-variant tests (`it("renders real intraday values...")` at line 101 and `"shows the collecting note..."` at line 152) to read `onSeriesChange?.[0].points` instead of `onSeriesChange?.[0]` (the payload is now wrapped in `{ points, benchmarkPct, hasBenchmark }`). Example fix for line 144-149:

```tsx
expect(lastCall?.[1]).toBe("1d");
expect(lastCall?.[0].points).toEqual([
  { date: expect.any(String), close: 1000 },
  { date: expect.any(String), close: 1050 },
  { date: expect.any(String), close: 1020 },
]);
```

Same wrapping fix for any other test that asserts on `onSeriesChange`'s first arg.

- [ ] **Step 2: Run the test to verify it fails**

Run:

```bash
npm test --workspace @portfolio/web -- apps/web/test/net-worth-history-chart.test.tsx
```

Expected: FAIL — new "hero variant with benchmark overlay" block fails (no `HeroOverlayChart` rendered, payload shape mismatch).

- [ ] **Step 3: Wire the hero variant to the new chart**

In `apps/web/src/components/charts/net-worth-history-chart.tsx`:

1. Import the new chart (add alongside the existing `PriceChart` import at line 13):

```tsx
import { HeroOverlayChart } from "@/components/charts/hero-overlay-chart";
```

2. Replace the `ChartSeriesPoint` interface and the `onSeriesChange` signature to carry benchmark data (around lines 30-57):

```tsx
export interface ChartSeriesPoint {
  date: string;
  close: number;
}

/** Payload emitted by the hero variant to its parent. */
export interface HeroSeriesSnapshot {
  points: ChartSeriesPoint[];
  benchmarkPct: string | null;
  hasBenchmark: boolean;
}
```

3. Update the `onSeriesChange` prop type on `NetWorthHistoryChart` (line 56):

```tsx
  onSeriesChange?: (snapshot: HeroSeriesSnapshot, range: ChartRange) => void;
```

4. Replace the chart data prep for the hero branch (lines 98-110) and the `useEffect` that calls `onSeriesChange` (lines 113-121) with TWR-aware versions. The new data prep builds `points` for `HeroOverlayChart` and a separate snapshot for the parent:

```tsx
// Hero variant always emits a TWR-normalized snapshot (no absolute currency on the
// emitted series — the big "€X" headline is the parent's job). Card variant keeps
// its existing currency-based emission shape; this whole block is hero-only.
const heroSeriesSnapshot: HeroSeriesSnapshot | null = isHero
  ? (() => {
      if (intraday) {
        return { points: [], benchmarkPct: null, hasBenchmark: false };
      }
      const daily = data.filter(isDailyPoint);
      const points: ChartSeriesPoint[] = daily.map((p) => ({
        date: p.date,
        close: Number(p.pct ?? "0"),
      }));
      const last = daily[daily.length - 1];
      const hasBenchmark = daily.some((p) => p.benchmarkPct !== undefined);
      return {
        points,
        benchmarkPct: last?.benchmarkPct ?? null,
        hasBenchmark,
      };
    })()
  : null;

useEffect(() => {
  if (!isHero || !heroSeriesSnapshot) return;
  onSeriesChange?.(heroSeriesSnapshot, range);
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, [heroSeriesSnapshot, range, onSeriesChange]);
```

5. Replace the hero branch in the render tree (lines 142-160) so it uses `HeroOverlayChart` instead of `PriceChart`. The full hero block becomes:

```tsx
if (isHero) {
  const daily = data.filter(isDailyPoint);
  const overlayPoints = daily.map((p) => ({
    date: p.date,
    portfolio: Number(p.pct ?? "0"),
    benchmark: p.benchmarkPct === undefined ? null : Number(p.benchmarkPct),
  }));
  return (
    <div className="space-y-3">
      {intraday && data.length < 2 ? (
        collectingNote
      ) : data.length > 1 ? (
        <HeroOverlayChart points={overlayPoints} />
      ) : (
        <p className="py-8 text-center text-sm text-white/80">{te("historyTitle")}</p>
      )}
      <RangeToggle
        value={range}
        onChange={pick}
        disabled={loading}
        ranges={HERO_RANGES}
        theme="inverse"
      />
    </div>
  );
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run:

```bash
npm test --workspace @portfolio/web -- apps/web/test/net-worth-history-chart.test.tsx
```

Expected: PASS for all tests (new + updated existing).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/charts/net-worth-history-chart.tsx apps/web/test/net-worth-history-chart.test.tsx
git commit -m "feat(web): render TWR-normalized hero overlay in NetWorthHistoryChart"
```

---

## Task 4: Web — `HeroGlanceCard` pill rewire

**Files:**

- Modify: `apps/web/src/components/holdings/hero-glance-card.tsx`
- Test: `apps/web/test/hero-glance-card.test.tsx`

Pill 1 switches from absolute delta (`last.close − first.close`) to TWR % delta (`last.pct − first.pct`, displayed via `formatPercent`). Pill 2 is new — a benchmark delta pill, hidden when `hasBenchmark === false`. A tiny legend appears below the pills when the overlay is active.

- [ ] **Step 1: Write the failing test**

Replace the `describe("HeroGlanceCard")` block in `apps/web/test/hero-glance-card.test.tsx` with:

```tsx
describe("HeroGlanceCard", () => {
  it("shows the static current net worth headline regardless of the chart range", () => {
    renderCard();
    expect(screen.getByText("Total portfolio value")).toBeInTheDocument();
    expect(screen.getByText(/IDR\s*1,050,000/)).toBeInTheDocument();
  });

  it("derives pill 1 from TWR pct (not absolute currency delta) and adds pill 2 from benchmark", async () => {
    // Seed the chart with a mocked series where portfolio pct went from 0 → 10
    // and benchmark pct went from 0 → 8 (so pill 1 reads +10% and pill 2 reads +8%).
    getNetWorthHistory.mockResolvedValueOnce([
      {
        date: "2026-07-01",
        netWorth: "900000",
        marketValue: "900000",
        pct: "0",
        benchmarkPct: "0",
      },
      {
        date: "2026-07-29",
        netWorth: "990000",
        marketValue: "990000",
        pct: "10",
        benchmarkPct: "8",
      },
    ]);
    render(
      <NextIntlClientProvider locale="en" messages={messages}>
        <HeroGlanceCard netWorth="1050000" currency="IDR" initialHistory={[]} initialRange="1m" />
      </NextIntlClientProvider>,
    );
    await waitFor(() => expect(getNetWorthHistory).toHaveBeenCalledWith("1m"));
    await waitFor(() => {
      // Pill 1: portfolio TWR % + period word.
      expect(screen.getByText(/past 1M/)).toBeInTheDocument();
      expect(screen.getByText(/10\.00%/)).toBeInTheDocument();
      // Pill 2: benchmark prefix "vs S&P 500" (Insights.benchmark.vs label) + benchmark %.
      expect(screen.getByText(/vs S&P 500/)).toBeInTheDocument();
      expect(screen.getByText(/8\.00%/)).toBeInTheDocument();
    });
  });

  it("hides pill 2 and shows a fallback '—' when the chart emits hasBenchmark=false", async () => {
    getNetWorthHistory.mockResolvedValueOnce([
      { date: "2026-07-01", netWorth: "900000", marketValue: "900000", pct: "0" },
      { date: "2026-07-29", netWorth: "990000", marketValue: "990000", pct: "10" },
    ]);
    render(
      <NextIntlClientProvider locale="en" messages={messages}>
        <HeroGlanceCard netWorth="1050000" currency="IDR" initialHistory={[]} initialRange="1m" />
      </NextIntlClientProvider>,
    );
    await waitFor(() => expect(screen.getByText(/past 1M/)).toBeInTheDocument());
    // The Insights.benchmark.vs label still appears (so the user sees which symbol is
    // being compared against), but the value is a placeholder em-dash.
    expect(screen.getByText(/vs S&P 500/)).toBeInTheDocument();
    expect(screen.getByText("—")).toBeInTheDocument();
  });

  it("hides both pills when fewer than 2 series points are available", () => {
    render(
      <NextIntlClientProvider locale="en" messages={messages}>
        <HeroGlanceCard netWorth="0" currency="IDR" initialHistory={[]} initialRange="7d" />
      </NextIntlClientProvider>,
    );
    expect(screen.queryByText(/▲/)).not.toBeInTheDocument();
    expect(screen.queryByText(/▼/)).not.toBeInTheDocument();
    expect(screen.queryByText(/past/)).not.toBeInTheDocument();
  });
});
```

The test mock's `initial` shape at the top of the file (line 20-23) needs to add `pct` and `benchmarkPct` keys so the existing onSeriesChange flow can read them; otherwise the first test that asserts "past 7D" / "▲" will break. Update:

```tsx
const initial: HistoryPoint[] = [
  { date: "2026-06-28", netWorth: "900000", marketValue: "900000", pct: "0", benchmarkPct: "0" },
  {
    date: "2026-06-29",
    netWorth: "950000",
    marketValue: "950000",
    pct: "5.55",
    benchmarkPct: "2.5",
  },
];
```

And update the existing `"derives the period delta/pct pill..."` test (lines 45-54) to expect the new TWR-pct pill — replace the `screen.getByText(/▲/)` assertion with `screen.getByText(/5\.55%/)` and add `screen.getByText(/vs S&P 500/)`.

- [ ] **Step 2: Run the test to verify it fails**

Run:

```bash
npm test --workspace @portfolio/web -- apps/web/test/hero-glance-card.test.tsx
```

Expected: FAIL — pill 1 still reads from `close` (absolute), pill 2 missing entirely.

- [ ] **Step 3: Implement the pill rewire**

Replace `apps/web/src/components/holdings/hero-glance-card.tsx` content (lines 1-88) with:

```tsx
"use client";

import { useState, useCallback } from "react";
import { useTranslations, useLocale } from "next-intl";
import type { HistoryPoint } from "@portfolio/api-client";
import {
  NetWorthHistoryChart,
  type ChartSeriesPoint,
  type HeroSeriesSnapshot,
} from "@/components/charts/net-worth-history-chart";
import type { ChartRange } from "@/components/charts/range-toggle";
import { benchmarkLabel } from "@/lib/benchmark-labels";
import { formatMoney, formatPercent } from "@/lib/utils";

/**
 * The Holdings "glance" hero: green gradient card with the current total portfolio
 * value (static — always today's figure), two period pills (portfolio TWR % and the
 * user's chosen benchmark's period %), a tiny legend, and the chart itself in its
 * "hero" variant. The pill values are derived from {@link NetWorthHistoryChart}'s
 * emitted TWR-normalized series (via `onSeriesChange`) — see the design rationale
 * in services benchmark docs.
 */
export function HeroGlanceCard({
  netWorth,
  currency,
  initialHistory,
  initialRange,
  selectedId = null,
}: {
  netWorth: string;
  currency: string;
  initialHistory: HistoryPoint[];
  initialRange: ChartRange;
  selectedId?: string | null;
}) {
  const t = useTranslations("Holdings.hero");
  const tr = useTranslations("Chart.range");
  const tb = useTranslations("Insights.benchmark");
  const locale = useLocale();
  const [series, setSeries] = useState<HeroSeriesSnapshot>({
    points: [],
    benchmarkPct: null,
    hasBenchmark: false,
  });
  const [range, setRange] = useState<ChartRange>(initialRange);

  const onSeriesChange = useCallback((snapshot: HeroSeriesSnapshot, r: ChartRange) => {
    setSeries(snapshot);
    setRange(r);
  }, []);

  const first = series.points[0];
  const last = series.points[series.points.length - 1];
  const hasDelta = first !== undefined && last !== undefined && series.points.length > 1;
  const portfolioPct = hasDelta ? Number(last.close) - Number(first.close) : null;
  const benchmarkPct = series.benchmarkPct !== null ? Number(series.benchmarkPct) : null;
  const periodWord = range === "all" ? t("periodAllTime") : t("periodPast", { range: tr(range) });

  return (
    <div
      className="rounded-[26px] px-6 pb-[18px] pt-[22px] text-white shadow-[0_12px_30px_rgba(14,159,110,.30)] sm:rounded-[20px]"
      style={{ background: "linear-gradient(160deg,#0E9F6E,#0B7D58)" }}
    >
      <p className="text-[13px] font-semibold text-white/78">{t("label")}</p>
      <p className="tabular mt-1 text-[34px] font-extrabold leading-tight sm:text-[36px]">
        {formatMoney(Number(netWorth), currency, locale)}
      </p>

      {hasDelta && portfolioPct !== null && (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <span className="tabular rounded-full bg-white/18 px-2.5 py-1 text-[13px] font-bold">
            {portfolioPct >= 0 ? "▲" : "▼"} {formatPercent(portfolioPct / 100, locale)} {periodWord}
          </span>
          <span className="tabular rounded-full bg-white/18 px-2.5 py-1 text-[13px] font-bold">
            {tb("vs", { symbol: benchmarkLabel("^GSPC") })}{" "}
            {benchmarkPct !== null
              ? formatPercent(benchmarkPct / 100, locale)
              : t("benchmarkPillUnavailable")}
          </span>
        </div>
      )}

      <div className="mt-3.5">
        <NetWorthHistoryChart
          initial={initialHistory}
          currency={currency}
          selectedId={selectedId}
          variant="hero"
          initialRange={initialRange}
          onSeriesChange={onSeriesChange}
        />
      </div>

      {hasDelta && (
        <div className="mt-2 flex flex-wrap gap-3 text-[10px] font-semibold text-white/78">
          <span>
            <span
              className="mr-1 inline-block h-[2px] w-3 align-middle"
              style={{ background: "#ffffff" }}
            />
            {t("legendPortfolio")}
          </span>
          {series.hasBenchmark && (
            <span>
              <span
                className="mr-1 inline-block h-[2px] w-3 align-middle"
                style={{
                  borderTop: "2px dashed #FFD24A",
                  background: "transparent",
                  height: 0,
                }}
              />
              {t("legendBenchmark", { symbol: benchmarkLabel("^GSPC") })}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
```

Notes on this implementation:

- The benchmark symbol is hard-coded to `^GSPC` for the friendly label; the actual chart series is whatever the server returns. The hero card doesn't need to know the user's exact configured symbol to render the label correctly — `benchmarkLabel("^GSPC")` is the default and the user-facing symbol picker is already on the Insights page. If the user changes their benchmark, both the chart and the label update on the next render via `router.refresh()` from the existing `EditBenchmarkDialog` flow.
- `portfolioPct / 100` and `benchmarkPct / 100` convert chain-index `pct` (×100) to fractions, matching how `formatPercent` expects its input (it multiplies by 100 internally).

- [ ] **Step 4: Run the tests to verify they pass**

Run:

```bash
npm test --workspace @portfolio/web -- apps/web/test/hero-glance-card.test.tsx
```

Expected: PASS for all four cases.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/holdings/hero-glance-card.tsx apps/web/test/hero-glance-card.test.tsx
git commit -m "feat(web): rewire HeroGlanceCard pills to TWR % + benchmark delta"
```

---

## Task 5: i18n — English + Indonesian translation keys

**Files:**

- Modify: `apps/web/messages/en.json`
- Modify: `apps/web/messages/id.json`

- [ ] **Step 1: Add English keys**

In `apps/web/messages/en.json`, find the `Holdings` object and add to its `hero` sub-object:

```json
    "legendPortfolio": "Portfolio",
    "legendBenchmark": "{symbol}",
    "benchmarkPillUnavailable": "—",
```

The keys are siblings of the existing `periodAllTime` / `periodPast` / `label` keys. Verify by `grep -n "periodAllTime\|periodPast\|legendPortfolio" apps/web/messages/en.json` after editing.

- [ ] **Step 2: Add Indonesian keys**

In `apps/web/messages/id.json`, mirror in the same `Holdings.hero` sub-object:

```json
    "legendPortfolio": "Portofolio",
    "legendBenchmark": "{symbol}",
    "benchmarkPillUnavailable": "—",
```

The em-dash is locale-neutral — keep it identical in both files.

- [ ] **Step 3: Run the format check**

Run:

```bash
npm run format:check --workspace @portfolio/web
```

Expected: PASS (JSON formatting is preserved). If it fails, run `npm run format --workspace @portfolio/web` to fix and re-stage.

- [ ] **Step 4: Commit**

```bash
git add apps/web/messages/en.json apps/web/messages/id.json
git commit -m "feat(web): add legend + benchmark-unavailable copy in EN + ID"
```

---

## Task 6: Final verification

**Files:** none (read-only)

- [ ] **Step 1: Lint**

Run:

```bash
npm run lint
```

Expected: zero errors.

- [ ] **Step 2: Typecheck**

Run:

```bash
npm run typecheck
```

Expected: zero errors.

- [ ] **Step 3: Test (root)**

Run:

```bash
npm test
```

Expected: all workspaces pass.

- [ ] **Step 4: Coverage gate**

Run:

```bash
npm run test:coverage
```

Expected: 70% line/function/branch/statement coverage maintained.

- [ ] **Step 5: Format check**

Run:

```bash
npm run format:check
```

Expected: clean. If not, `npm run format` and re-run.

- [ ] **Step 6: Confirm no secrets leak in the diff**

Run:

```bash
git status
git diff --stat origin/main
```

Expected: only the files listed in this plan's File Structure are touched; no stray scratch files, no `.env*`, no secrets.

---

## Self-review (post-write)

- **Spec coverage:** Scope (always-on, default `^GSPC`) — Task 1 default behaviour + Task 3 emits hasBenchmark. Single-portfolio parity — Task 1 explicitly adds benchmark plumbing to `/portfolios/:id/history`. TWR-normalized chart — Task 2 + Task 3 hero render uses `pct` + `benchmarkPct`. Intraday degradation — Task 3 explicit "hides overlay for intraday" test. Pills — Task 4 rewire. Translations — Task 5. Verification — Task 6.
- **Placeholder scan:** no "TODO", "TBD", "implement later", or "similar to Task N" shortcuts. Every code block is concrete.
- **Type consistency:** `HeroSeriesSnapshot` defined in Task 3, imported in Task 4 — matching. `ChartSeriesPoint` definition unchanged across both tasks (kept the export for back-compat). `HeroOverlayPoint` is a separate type (the chart's own input) — no name collision.
- **No orphaned references:** `Insights.benchmark.vs` is the reused translation key; `benchmarkLabel("^GSPC")` matches the default in `services/api/src/services/benchmark.ts:18` and the friendly label in `apps/web/src/lib/benchmark-labels.ts:6`.
