import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import messages from "../messages/en.json";

import { IncomeEventsTable, type IncomeEventRow } from "../src/components/income/income-events-table";

const HISTORICAL: IncomeEventRow = {
  instrumentId: "i1",
  symbol: "BBCA",
  name: "Bank Central Asia",
  type: "dividend",
  date: "2025-07-15",
  amount: "500000",
  currency: "IDR",
};

const UPCOMING: IncomeEventRow = {
  instrumentId: "i2",
  symbol: "TLKM",
  name: "Telkom Indonesia",
  type: "dividend",
  date: "2026-08-20",
  amount: "300000",
  currency: "IDR",
  status: "projected",
};

function wrap(ui: React.ReactNode) {
  return render(
    <NextIntlClientProvider locale="en" messages={messages}>
      {ui}
    </NextIntlClientProvider>,
  );
}

describe("IncomeEventsTable", () => {
  // The timeline renders both a desktop grid row and a mobile flex row (CSS hides one);
  // in jsdom both are in the DOM, so symbols appear more than once → use *AllByText.
  it("renders the instrument and its type for historical events", () => {
    wrap(<IncomeEventsTable rows={[HISTORICAL]} />);
    expect(screen.getAllByText("BBCA").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Dividend").length).toBeGreaterThan(0);
    // No forecast markers on a received row.
    expect(screen.queryByText("est.")).not.toBeInTheDocument();
  });

  it("de-emphasises forecast payments with an est. tag and reduced opacity", () => {
    const { container } = wrap(<IncomeEventsTable rows={[UPCOMING]} />);
    expect(screen.getAllByText("TLKM").length).toBeGreaterThan(0);
    // Forecast is conveyed by the "est." micro-tag (no separate status pill).
    expect(screen.getAllByText("est.").length).toBeGreaterThan(0);
    // The row wrapper carries opacity 0.78 (reference forecast de-emphasis).
    const dimmed = Array.from(container.querySelectorAll<HTMLElement>("[style]")).some(
      (el) => el.style.opacity === "0.78",
    );
    expect(dimmed).toBe(true);
  });

  it("renders mixed historical and upcoming rows", () => {
    wrap(<IncomeEventsTable rows={[HISTORICAL, UPCOMING]} />);
    expect(screen.getAllByText("BBCA").length).toBeGreaterThan(0);
    expect(screen.getAllByText("TLKM").length).toBeGreaterThan(0);
    expect(screen.getAllByText("est.").length).toBeGreaterThan(0);
  });

  it("does not dim historical rows", () => {
    const { container } = wrap(<IncomeEventsTable rows={[HISTORICAL]} />);
    const dimmed = Array.from(container.querySelectorAll<HTMLElement>("[style]")).some(
      (el) => el.style.opacity === "0.78",
    );
    expect(dimmed).toBe(false);
  });
});
