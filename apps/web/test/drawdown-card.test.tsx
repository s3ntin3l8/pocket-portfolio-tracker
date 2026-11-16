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
    const note = screen.getByText(/The 2021-11-08 high was set when holdings were worth/);
    expect(note).toHaveTextContent("€466.00");
    expect(note).toHaveTextContent("€33,130.00");
    expect(screen.getByText(/time-weighted/)).toBeInTheDocument();
  });

  it("dates each size note with its own high when the current high differs from the deepest episode's", () => {
    renderCard({
      ...base,
      currentPeakDate: "2024-05-20",
      peakValue: "466",
      currentPeakValue: "28000",
      currentValue: "33130",
    });
    // The deepest drop started on a tiny book; the high the current drawdown is measured from did not.
    const notes = screen.getAllByText(/high was set when holdings were worth/);
    expect(notes).toHaveLength(1);
    expect(notes[0]).toHaveTextContent("The 2021-11-08 high");
    expect(notes[0]).toHaveTextContent("€466.00");
    expect(screen.queryByText(/2024-05-20 high was set/)).toBeNull();
  });

  it("also explains a small CURRENT high with that high's own value", () => {
    renderCard({
      ...base,
      currentPeakDate: "2024-05-20",
      peakValue: "466",
      currentPeakValue: "5000",
      currentValue: "33130",
    });
    expect(screen.getAllByText(/high was set when holdings were worth/)).toHaveLength(2);
    expect(
      screen.getByText(/The 2024-05-20 high was set when holdings were worth €5,000\.00/),
    ).toBeInTheDocument();
    expect(screen.getAllByText(/time-weighted/)).toHaveLength(1);
    // Today's value is stated once, not repeated on the second note.
    expect(screen.getAllByText(/today they are worth/)).toHaveLength(1);
  });

  it("leaves the size note out when the high was set on a book of comparable size", () => {
    renderCard({ ...base, peakValue: "30000", currentPeakValue: "30000", currentValue: "33130" });
    expect(screen.queryByText(/high was set when holdings/)).toBeNull();
  });

  it("leaves the size note out without a currency or without values", () => {
    const { unmount } = renderCard({ ...base, peakValue: "466", currentValue: "33130" }, null);
    expect(screen.queryByText(/high was set when holdings/)).toBeNull();
    unmount();
    renderCard(base);
    expect(screen.queryByText(/high was set when holdings/)).toBeNull();
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
