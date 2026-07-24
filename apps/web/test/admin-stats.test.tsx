import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import type * as React from "react";
import type { AdminStats as AdminStatsData } from "@portfolio/api-client";

// Identity translator — the component's own literal strings (formatBytes/formatRows
// output) are asserted directly rather than through i18n, so this just needs to echo keys.
vi.mock("next-intl/server", () => ({
  getTranslations: vi.fn(async () => (key: string) => key),
}));

const { AdminStats } = await import("../src/components/admin-stats");

function stats(overrides: Partial<AdminStatsData> = {}): AdminStatsData {
  return {
    db: { sizeBytes: 128 * 1024 * 1024, tables: [] },
    objectStorage: { configured: false },
    ...overrides,
  };
}

async function renderStats(data: AdminStatsData) {
  const el = await AdminStats({ stats: data });
  return render(el as React.ReactElement);
}

describe("AdminStats", () => {
  it("renders the database-size tile, formatted", async () => {
    await renderStats(stats());
    expect(screen.getByText("128.0 MB")).toBeInTheDocument();
  });

  it("shows an unavailable placeholder when the DB size is null", async () => {
    await renderStats(stats({ db: { sizeBytes: null, tables: [] } }));
    expect(screen.getByText("statsSizeUnavailable")).toBeInTheDocument();
  });

  it("sums rows across tables for the 'Rows (est.)' tile when every table reports a count", async () => {
    await renderStats(
      stats({
        db: {
          sizeBytes: 1024,
          tables: [
            { name: "transactions", rows: 12_480, sizeBytes: 44_147_200 },
            { name: "prices", rows: 96_320, sizeBytes: 64_200_000 },
          ],
        },
      }),
    );
    expect(screen.getByText("108,800")).toBeInTheDocument();
  });

  it("shows '—' for the rows total when any table's count is unavailable (doesn't silently undercount)", async () => {
    await renderStats(
      stats({
        db: {
          sizeBytes: 1024,
          tables: [
            { name: "transactions", rows: 12_480, sizeBytes: 44_147_200 },
            { name: "audit_log", rows: null, sizeBytes: null },
          ],
        },
      }),
    );
    // Total tile + audit_log's own null rows/size cells — three dashes, not zero or one.
    expect(screen.getAllByText("—")).toHaveLength(3);
    expect(screen.getByText("12,480")).toBeInTheDocument(); // transactions' own count still shown
  });

  it("shows the table breakdown-unavailable note when there are no tables", async () => {
    await renderStats(stats({ db: { sizeBytes: 1024, tables: [] } }));
    expect(screen.getByText("statsTableBreakdownUnavailable")).toBeInTheDocument();
  });

  it("lists each table with formatted rows and size", async () => {
    // Two tables so the per-row count (8) can't collide with the tile's summed total (11).
    await renderStats(
      stats({
        db: {
          sizeBytes: 1024,
          tables: [
            { name: "portfolios", rows: 8, sizeBytes: 65_536 },
            { name: "account_holders", rows: 3, sizeBytes: 16_384 },
          ],
        },
      }),
    );
    expect(screen.getByText("portfolios")).toBeInTheDocument();
    expect(screen.getByText("8")).toBeInTheDocument();
    expect(screen.getByText("64.0 KB")).toBeInTheDocument();
  });

  it("shows the 'object storage not used' callout when storage isn't configured", async () => {
    await renderStats(stats({ objectStorage: { configured: false } }));
    expect(screen.getByText("statsObjectStorageNotUsedTitle")).toBeInTheDocument();
    expect(screen.queryByText("statsObjectStorage")).toBeNull();
  });

  it("shows real object-storage stats when storage is configured", async () => {
    await renderStats(
      stats({
        objectStorage: {
          configured: true,
          provider: "s3",
          objectCount: 42,
          totalBytes: 2048,
          freeBytes: 1024 * 1024 * 1024,
          diskTotalBytes: 4 * 1024 * 1024 * 1024,
        },
      }),
    );
    expect(screen.getByText("statsObjectStorage")).toBeInTheDocument();
    expect(screen.queryByText("statsObjectStorageNotUsedTitle")).toBeNull();
    expect(screen.getByText("s3")).toBeInTheDocument();
    expect(screen.getByText("42")).toBeInTheDocument();
    expect(screen.getByText("2.0 KB")).toBeInTheDocument();
  });

  it("shows the stats error instead of a dl when the configured provider's fetch failed", async () => {
    await renderStats(stats({ objectStorage: { configured: true, error: "connection refused" } }));
    expect(screen.getByText("connection refused")).toBeInTheDocument();
    expect(screen.queryByText("statsProviderLabel")).toBeNull();
  });
});
