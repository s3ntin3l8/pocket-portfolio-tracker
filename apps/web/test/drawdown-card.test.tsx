import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { InsightsDrawdown } from "@portfolio/api-client";
import { DrawdownCard } from "@/components/insights/drawdown-card";
import messages from "../messages/en.json";

function renderCard(drawdown: InsightsDrawdown, currency: string | null = "EUR") {
  return render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <DrawdownCard drawdown={drawdown} locale="en" currency={currency ?? undefined} />
    </NextIntlClientProvider>,
  );
}

const base: InsightsDrawdown = {
  maxDrawdownPct: "-0.772",
  peakDate: "2021-11-08",
  troughDate: "2022-06-18",
  currentDrawdownPct: "-0.3535",
  currentPeakDate: "2021-11-08",
};

describe("DrawdownCard", () => {
  it("names the high the current drawdown is measured from instead of 'still underwater'", () => {
    renderCard(base);
    expect(screen.getByText(/measured from the 2021-11-08 high/)).toBeInTheDocument();
    expect(screen.queryByText(/underwater/i)).toBeNull();
  });

  it("says the deepest episode has not recovered, or how long it took", () => {
    const { unmount } = renderCard(base);
    expect(screen.getByText(/Not yet recovered/)).toBeInTheDocument();
    unmount();
    renderCard({ ...base, recoveryDate: "2024-07-02", recoveryDays: 552 });
    expect(screen.getByText(/Recovered in 552d/)).toBeInTheDocument();
    expect(screen.queryByText(/Not yet recovered/)).toBeNull();
  });

  it("puts a drawdown set on a tiny book into perspective", () => {
    renderCard({ ...base, peakValue: "466", currentPeakValue: "466", currentValue: "33130" });
    const note = screen.getByText(/That high was set when holdings were worth/);
    expect(note).toHaveTextContent("€466.00");
    expect(note).toHaveTextContent("€33,130.00");
    expect(note).toHaveTextContent(/time-weighted/);
  });

  it("leaves the size note out when the high was set on a book of comparable size", () => {
    renderCard({ ...base, peakValue: "30000", currentPeakValue: "30000", currentValue: "33130" });
    expect(screen.queryByText(/That high was set/)).toBeNull();
  });

  it("leaves the size note out without a currency or without values", () => {
    const { unmount } = renderCard({ ...base, peakValue: "466", currentValue: "33130" }, null);
    expect(screen.queryByText(/That high was set/)).toBeNull();
    unmount();
    renderCard(base);
    expect(screen.queryByText(/That high was set/)).toBeNull();
  });

  it("shows no 'measured from' or 'not recovered' text when there is no drawdown", () => {
    renderCard({
      maxDrawdownPct: "0",
      peakDate: "2026-01-01",
      troughDate: "2026-01-01",
      currentDrawdownPct: "0",
      currentPeakDate: "2026-01-01",
    });
    expect(screen.queryByText(/measured from the/)).toBeNull();
    expect(screen.queryByText(/Not yet recovered/)).toBeNull();
  });
});
