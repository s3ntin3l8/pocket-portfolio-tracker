import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("@/i18n/navigation", () => ({
  Link: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));

import messages from "../messages/en.json";
import { ReconciliationBanner } from "../src/components/transactions/activity-banners";
import { anomalyLabel, reconciliationItem, type AnomalyTranslator } from "../src/lib/utils";

// Minimal ICU-ish translator over the real EN messages: enough for `{name}` interpolation.
const ta: AnomalyTranslator = (key, values) => {
  const path = key.split(".");
  let node: unknown = messages.Anomalies;
  for (const p of path) node = (node as Record<string, unknown>)[p];
  return String(node).replace(/\{(\w+)\}/g, (_, k) => values?.[k] ?? `{${k}}`);
};

describe("reconciliation anomaly labels", () => {
  it("formats cash amounts as money in their currency, not raw decimal strings", () => {
    const label = anomalyLabel(
      {
        code: "reconciliation_gap",
        meta: { currency: "EUR", reported: "271.35", derived: "277.6105676789849252" },
      },
      ta,
      "en",
    );
    expect(label).toBe(
      "Cash reconciliation gap vs. broker (EUR: reported €271.35, derived €277.61)",
    );
  });

  it("formats position quantities (trimmed, ≤6 dp) and names the instrument when resolved", () => {
    const label = anomalyLabel(
      {
        code: "position_gap",
        meta: {
          isin: "US56035L1044",
          symbol: "MAIN",
          reported: "29.012179",
          derived: "28.876429",
        },
      },
      ta,
      "en",
    );
    expect(label).toBe(
      "Position reconciliation gap vs. broker (MAIN · US56035L1044: reported 29.012179, derived 28.876429)",
    );
  });

  it("falls back to the bare ISIN when the instrument isn't known", () => {
    const label = anomalyLabel(
      { code: "position_gap", meta: { isin: "XX0000000001", reported: "1.500000", derived: "1" } },
      ta,
      "en",
    );
    expect(label).toContain("(XX0000000001: reported 1.5, derived 1)");
  });
});

describe("reconciliationItem", () => {
  it("titles a position gap as a position, links to the instrument, keys per portfolio", () => {
    const item = reconciliationItem(
      {
        code: "position_gap",
        meta: {
          isin: "US1",
          instrumentId: "inst-1",
          portfolioId: "p1",
          reported: "2",
          derived: "1",
        },
      },
      ta,
      "en",
    );
    expect(item.title).toBe("Position doesn't reconcile");
    expect(item.action).toEqual({ href: "/instruments/inst-1", label: "View holding" });
    expect(item.key).toBe("position_gap:US1:p1");
  });

  it("titles a cash gap as cash and links to its portfolio's settings (connection lives there)", () => {
    const item = reconciliationItem(
      { code: "reconciliation_gap", meta: { currency: "EUR", reported: "1", derived: "2" } },
      ta,
      "en",
      "p9",
    );
    expect(item.title).toBe("Cash doesn't reconcile");
    expect(item.action).toEqual({ href: "/settings/portfolios/p9", label: "Open connection" });
  });

  it("offers no link when the target isn't known", () => {
    const item = reconciliationItem(
      { code: "position_gap", meta: { isin: "US1", reported: "2", derived: "1" } },
      ta,
      "en",
    );
    expect(item.action).toBeUndefined();
  });
});

describe("ReconciliationBanner action", () => {
  it("renders the link only when an action is given", () => {
    const { rerender } = render(<ReconciliationBanner title="T" detail="D" tag="Portfolio" />);
    expect(screen.queryByRole("link")).toBeNull();
    rerender(
      <ReconciliationBanner
        title="T"
        detail="D"
        tag="Portfolio"
        action={{ href: "/instruments/i1", label: "View holding" }}
      />,
    );
    expect(screen.getByRole("link", { name: "View holding" })).toHaveAttribute(
      "href",
      "/instruments/i1",
    );
  });
});
